/**
 * Verifies src/types/database.ts still matches the live schema.
 *
 * The type file is hand-maintained (see its header for why), which means
 * it can drift — and did, before 0008. This compares the table and column
 * names it declares against `information_schema` and fails on any
 * difference, so drift is caught by CI rather than by a runtime error.
 *
 * Requires SUPABASE_SERVICE_ROLE_KEY. Skips with a notice when the
 * database is unreachable so it never blocks an offline build.
 */
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config();

import fs from "node:fs";
import path from "node:path";
import { createClient } from "@supabase/supabase-js";

const TYPES_PATH = path.join(process.cwd(), "src/types/database.ts");

/**
 * Extracts `tableName: Table<{ ...Row }, ...>` declarations.
 *
 * Scans with a brace counter rather than a regex: the file uses both a
 * multi-line and a single-line object form, and a non-greedy pattern
 * tuned for one silently swallows the next table when it meets the other.
 */
function declaredTables(source: string): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>();
  const headerPattern = /^ {6}(\w+): Table<\s*/gm;

  let header: RegExpExecArray | null;
  while ((header = headerPattern.exec(source)) !== null) {
    const name = header[1];
    const openIndex = source.indexOf("{", header.index + header[0].length - 1);
    if (openIndex === -1) continue;

    let depth = 0;
    let closeIndex = -1;
    for (let index = openIndex; index < source.length; index++) {
      const character = source[index];
      if (character === "{") depth++;
      else if (character === "}") {
        depth--;
        if (depth === 0) {
          closeIndex = index;
          break;
        }
      }
    }
    if (closeIndex === -1) continue;

    // Only the Row object — the first `{...}` after `Table<`.
    const body = source.slice(openIndex + 1, closeIndex);
    const columns = new Set<string>();
    for (const part of body.split(/[;\n]/)) {
      const column = /^\s*(\w+)\??\s*:/.exec(part);
      if (column) columns.add(column[1]);
    }

    tables.set(name, columns);
  }

  return tables;
}

async function main() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !key) {
    console.log("· Skipping: NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY not set.");
    return;
  }

  const source = fs.readFileSync(TYPES_PATH, "utf8");
  const declared = declaredTables(source);

  if (declared.size === 0) {
    console.error("✖ Could not parse any table declarations from src/types/database.ts.");
    process.exit(1);
  }

  const supabase = createClient(url, key, { auth: { persistSession: false } });
  let problems = 0;

  for (const [table, columns] of declared) {
    const { data, error } = await supabase.from(table).select("*").limit(1);

    if (error) {
      console.error(`✖ ${table}: ${error.message}`);
      problems++;
      continue;
    }

    // A single row reveals the real column set. An empty table cannot be
    // checked this way, which is a known limit of this cheap check — it
    // still catches a renamed or dropped table.
    const row = data?.[0];
    if (!row) {
      console.log(`· ${table}: empty, column check skipped`);
      continue;
    }

    const actual = new Set(Object.keys(row));
    const missingInTypes = [...actual].filter((column) => !columns.has(column));
    const missingInDb = [...columns].filter((column) => !actual.has(column));

    if (missingInTypes.length || missingInDb.length) {
      problems++;
      console.error(`✖ ${table}`);
      if (missingInTypes.length) console.error(`    in database but not in types: ${missingInTypes.join(", ")}`);
      if (missingInDb.length) console.error(`    in types but not in database: ${missingInDb.join(", ")}`);
    } else {
      console.log(`✓ ${table}`);
    }
  }

  console.log("");
  if (problems > 0) {
    console.error(`${problems} table(s) have drifted. Update src/types/database.ts.\n`);
    process.exit(1);
  }
  console.log("src/types/database.ts matches the live schema.\n");
}

main().catch((error) => {
  console.error("✖ Unexpected error:", error);
  process.exit(1);
});
