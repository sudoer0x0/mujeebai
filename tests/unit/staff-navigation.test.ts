import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Guards the class of bug that shipped three times in one change.
 *
 * The staff consoles live behind a secret path prefix. Every navigation
 * to `/admin`, `/moderator` or `/staff/*` therefore has to carry that
 * prefix — from `staffPortalHref` on the server, or `useStaffBase` in the
 * browser. Prefixing was being done by hand at each call site, so each new
 * one was a fresh chance to forget: the MFA step-up remembered, the MFA
 * *challenge* did not, and neither did either onboarding step. The symptom
 * is always the same and always late — the operator authenticates
 * correctly and lands on a 404.
 *
 * A type cannot catch this (every candidate is a `string`), so it is
 * caught here instead: no source file may navigate or redirect to a bare
 * staff path.
 */

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(full)) out.push(full);
  }
  return out;
}

/**
 * A navigation whose target begins with a staff segment and nothing else.
 *
 * Matches `router.replace("/admin")`, `redirect(`/${locale}/staff/login`)`
 * and `href="/moderator/users"`. Does not match a target that starts with
 * an interpolated prefix such as `${base}` or `${staffPortalHref(...)}`,
 * which is exactly the correct form.
 */
const BARE_STAFF_TARGET =
  /(?:router\.(?:replace|push)|redirect|window\.location\.assign|href=)\s*[({=]?\s*[`"'](?:\/\$\{locale\})?\/(?:admin|moderator|staff)(?:\/|["'`])/;

const ALLOWED = new Set([
  // The one place the canonical paths are legitimately literals: the
  // module that defines what a staff path *is*.
  "src/auth/portal-path.ts",
  // The matrix names portals as data, not as navigation targets.
  "src/admin/permissions.ts",
  // Middleware reasons about internal paths by design.
  "src/middleware.ts",
]);

test("no source file navigates to an unprefixed staff path", () => {
  const offenders: string[] = [];

  for (const file of walk("src")) {
    const rel = file.replace(/\\/g, "/");
    if (ALLOWED.has(rel)) continue;

    const lines = readFileSync(file, "utf8").split("\n");
    lines.forEach((line, i) => {
      if (line.trimStart().startsWith("*") || line.trimStart().startsWith("//")) return;
      if (BARE_STAFF_TARGET.test(line)) offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
    });
  }

  assert.deepEqual(
    offenders,
    [],
    "These navigate to a staff path without the secret prefix, so they will 404:\n" + offenders.join("\n"),
  );
});
