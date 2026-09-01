/**
 * Message-catalog checker.
 *
 * Finds two failure modes that otherwise only surface at render time (or,
 * worse, only in the one locale nobody tested):
 *
 *   1. keys the code asks for that a catalog does not define — which
 *      throws MISSING_MESSAGE and can break a whole page;
 *   2. locales that have drifted behind `en`.
 *
 * It resolves each `t("…")` against the namespace its `useTranslations` /
 * `getTranslations` call declared, so `useTranslations("admin.users")`
 * plus `t("title")` is checked as `admin.users.title`.
 *
 * Necessarily approximate: keys built at runtime (template literals,
 * `t(variable)`) cannot be seen statically, so they are reported
 * separately as dynamic prefixes to eyeball rather than treated as
 * missing. Run with `npm run check-i18n`.
 */
import fs from "node:fs";
import path from "node:path";

const MESSAGES_DIR = path.join(process.cwd(), "messages");
const SOURCE_DIR = path.join(process.cwd(), "src");
const BASE_LOCALE = "en";

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

function flatten(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      flatten(child, prefix ? `${prefix}.${key}` : key, out);
    }
  } else if (prefix) {
    out.add(prefix);
  }
  return out;
}

interface Usage {
  key: string;
  file: string;
}

/**
 * Extracts the namespace-resolved keys a file asks for.
 *
 * Tracks which local variable each translator was assigned to, so a file
 * holding several (`const t = useTranslations("admin")` alongside
 * `const tc = useTranslations("admin.common")`) resolves each call against
 * the right namespace instead of guessing.
 */
function extractUsages(file: string, source: string): { keys: Usage[][]; dynamic: string[] } {
  // A variable maps to a *set* of namespaces, not one: a file commonly
  // declares `const t = useTranslations("admin.plans")` in the component
  // and `const t = useTranslations("admin.common")` in a helper below it.
  // Taking only the last declaration reports every key from the first as
  // missing.
  const namespaces = new Map<string, Set<string>>();
  const dynamic: string[] = [];

  function record(variable: string, namespace: string) {
    const existing = namespaces.get(variable) ?? new Set<string>();
    existing.add(namespace);
    namespaces.set(variable, existing);
  }

  const declPattern =
    /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?(?:useTranslations|getTranslations)\s*\(\s*(?:\{[^}]*namespace:\s*)?["'`]([^"'`]*)["'`]/g;
  let decl: RegExpExecArray | null;
  const dynamicVariables = new Set<string>();
  while ((decl = declPattern.exec(source)) !== null) {
    // A namespace built at runtime (`namespace: \`emails.${kind}\``)
    // cannot be resolved statically; note it and skip its call sites.
    if (decl[2].includes("${")) {
      dynamicVariables.add(decl[1]);
      dynamic.push(decl[2]);
      continue;
    }
    record(decl[1], decl[2]);
  }

  // A translator created with no namespace resolves keys from the root.
  const rootPattern = /(?:const|let)\s+(\w+)\s*=\s*(?:await\s+)?useTranslations\s*\(\s*\)/g;
  let root: RegExpExecArray | null;
  while ((root = rootPattern.exec(source)) !== null) {
    record(root[1], "");
  }

  // Each entry is the set of candidate resolutions for one call site; the
  // call is satisfied if *any* candidate exists in the catalog.
  const keys: Usage[][] = [];

  for (const [variable, variableNamespaces] of namespaces) {
    if (dynamicVariables.has(variable)) continue;
    const callPattern = new RegExp(`\\b${variable}\\s*\\(\\s*(["'\`])([^"'\`]*?)\\1`, "g");
    let call: RegExpExecArray | null;
    while ((call = callPattern.exec(source)) !== null) {
      const raw = call[2];
      if (!raw) continue;

      // Template literals with an interpolation are runtime-built.
      if (raw.includes("${")) {
        for (const namespace of variableNamespaces) dynamic.push(namespace || "(root)");
        continue;
      }

      keys.push(
        [...variableNamespaces].map((namespace) => ({
          key: namespace ? `${namespace}.${raw}` : raw,
          file,
        })),
      );
    }

    // `t(someVariable as never)` — nothing static to resolve.
    const dynamicPattern = new RegExp(`\\b${variable}\\s*\\(\\s*[A-Za-z_$][\\w$.]*\\s*(?:as|,|\\))`, "g");
    if (dynamicPattern.test(source)) {
      for (const namespace of variableNamespaces) dynamic.push(namespace || "(root)");
    }
  }

  return { keys, dynamic };
}

function main() {
  const locales = fs
    .readdirSync(MESSAGES_DIR)
    .filter((name) => name.endsWith(".json"))
    .map((name) => name.replace(/\.json$/, ""));

  const catalogs = new Map<string, Set<string>>();
  for (const locale of locales) {
    const json = JSON.parse(fs.readFileSync(path.join(MESSAGES_DIR, `${locale}.json`), "utf8"));
    catalogs.set(locale, flatten(json));
  }

  const base = catalogs.get(BASE_LOCALE);
  if (!base) {
    console.error(`✖ No ${BASE_LOCALE}.json catalog found.`);
    process.exit(1);
  }

  console.log("\nMujeeb AI — message catalog check\n");

  let problems = 0;

  // 1. Keys the code asks for that `en` does not define.
  const callSites: Usage[][] = [];
  const dynamicNamespaces = new Set<string>();

  for (const file of walk(SOURCE_DIR)) {
    const source = fs.readFileSync(file, "utf8");
    const { keys, dynamic } = extractUsages(file, source);
    callSites.push(...keys);
    for (const namespace of dynamic) dynamicNamespaces.add(namespace);
  }

  const baseKeys = [...base];
  const satisfied = (key: string) =>
    // Either the exact key exists, or it is a namespace prefix of one that
    // does (t("a.b") in a file that also resolves a.b.c) — a prefix match
    // is not a missing key.
    base.has(key) || baseKeys.some((candidate) => candidate.startsWith(`${key}.`));

  const missingInBase = callSites
    .filter((candidates) => !candidates.some((usage) => satisfied(usage.key)))
    .map((candidates) => [candidates[0].key, path.relative(process.cwd(), candidates[0].file)] as const);

  if (missingInBase.length > 0) {
    const uniqueCount = new Set(missingInBase.map(([key]) => key)).size;
    problems += uniqueCount;
    console.error(`✖ ${uniqueCount} key(s) used in code but missing from ${BASE_LOCALE}.json:`);
    const unique = new Map(missingInBase);
    for (const [key, file] of [...unique].sort()) console.error(`    ${key}   ← ${file}`);
    console.error("");
  } else {
    console.log(`✓ Every statically-resolvable key exists in ${BASE_LOCALE}.json`);
  }

  // 2. Locales that have drifted behind the base catalog.
  for (const locale of locales) {
    if (locale === BASE_LOCALE) continue;
    const catalog = catalogs.get(locale)!;

    const missing = [...base].filter((key) => !catalog.has(key));
    const extra = [...catalog].filter((key) => !base.has(key));

    if (missing.length === 0 && extra.length === 0) {
      console.log(`✓ ${locale} — ${catalog.size} keys, in sync`);
      continue;
    }

    problems += missing.length + extra.length;
    console.error(`✖ ${locale}`);
    if (missing.length) {
      console.error(`    missing ${missing.length}: ${missing.slice(0, 12).join(", ")}${missing.length > 12 ? ", …" : ""}`);
    }
    if (extra.length) {
      console.error(`    extra ${extra.length}: ${extra.slice(0, 12).join(", ")}${extra.length > 12 ? ", …" : ""}`);
    }
  }

  if (dynamicNamespaces.size > 0) {
    console.log(`\n· Namespaces with runtime-built keys (verify by hand): ${[...dynamicNamespaces].sort().join(", ")}`);
  }

  console.log("");

  if (problems > 0) {
    console.error(`${problems} catalog problem(s) found.\n`);
    process.exit(1);
  }

  console.log("All catalogs are complete and in sync.\n");
}

main();
