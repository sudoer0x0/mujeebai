import test from "node:test";
import assert from "node:assert/strict";

/**
 * The staff portal's secret prefix.
 *
 * These are the rules the middleware depends on to decide what to rewrite
 * and what to answer with 404, so a regression here silently either
 * exposes `/admin` or locks the console out entirely.
 *
 * The module reads `process.env` at call time, so each case sets the
 * variable and re-imports through a cache-busting query string.
 */
async function load(staff: string | undefined, admin?: string) {
  if (staff === undefined) delete process.env.STAFF_PORTAL_SLUG;
  else process.env.STAFF_PORTAL_SLUG = staff;
  if (admin === undefined) delete process.env.ADMIN_PORTAL_SLUG;
  else process.env.ADMIN_PORTAL_SLUG = admin;
  return import(`@/auth/portal-path?v=${Math.random()}`);
}

test("unset slug leaves the console at its canonical path", async () => {
  const m = await load(undefined);
  assert.equal(m.portalPrefix("staff"), "");
  assert.equal(m.staffPortalHref("/admin"), "/admin");
  assert.equal(m.staffPortalHref("/admin/users", "en"), "/en/admin/users");
});

test("a configured slug prefixes every staff href", async () => {
  const m = await load("s3cret");
  assert.equal(m.portalPrefix("staff"), "/s3cret");
  assert.equal(m.staffPortalHref("/admin"), "/s3cret/admin");
  assert.equal(m.staffPortalHref("/staff/login", "fr"), "/fr/s3cret/staff/login");
});

test("a malformed slug is ignored rather than half-applied", async () => {
  // Each of these would either break the matcher or let the value itself
  // smuggle in a path. Falling back to no prefix keeps the console
  // reachable; applying them partially would not.
  for (const bad of ["", "  ", "a/b", "../etc", "has space", "dot.dot", "a".repeat(65), "sl$ug"]) {
    const m = await load(bad);
    assert.equal(m.portalPrefix("staff"), "", `"${bad}" must be rejected`);
  }
});

test("a slug that collides with a real segment is refused", async () => {
  // `/admin/admin` is not a secret, and the middleware's 404 rule would
  // make the console unreachable.
  for (const bad of ["admin", "moderator", "staff", "ADMIN"]) {
    const m = await load(bad);
    assert.equal(m.portalPrefix("staff"), "", `"${bad}" must be refused`);
  }
});

test("surrounding slashes are tolerated", async () => {
  const m = await load("/wrapped/");
  assert.equal(m.portalPrefix("staff"), "/wrapped");
});

test("staff segments are matched exactly, never by prefix", async () => {
  const m = await load(undefined);
  for (const p of ["/admin", "/admin/users", "/moderator", "/moderator/users/1", "/staff", "/staff/login"]) {
    assert.equal(m.isStaffSegment(p), true, `${p} is staff`);
  }
  // `/adminx` must not be treated as the console, or the 404 rule would
  // swallow unrelated routes that merely start with the same letters.
  for (const p of ["/adminx", "/administrator", "/chat", "/", "/moderators", "/staffing"]) {
    assert.equal(m.isStaffSegment(p), false, `${p} is not staff`);
  }
});

test("the two consoles get separate secrets", async () => {
  const m = await load("modsecret", "adminsecret");
  assert.equal(m.portalPrefix("admin"), "/adminsecret");
  assert.equal(m.portalPrefix("staff"), "/modsecret");
  assert.equal(m.staffPortalHref("/admin/users"), "/adminsecret/admin/users");
  assert.equal(m.staffPortalHref("/moderator"), "/modsecret/moderator");
});

test("the moderator secret cannot reach the admin console", async () => {
  const m = await load("modsecret", "adminsecret");
  // This is the whole reason for two slugs: a moderator learns their own
  // URL by using it, and that must not also be the administrator's.
  assert.equal(m.resolveInternalPath("modsecret", "/admin"), null);
  assert.equal(m.resolveInternalPath("modsecret", "/admin/users"), null);
  assert.equal(m.resolveInternalPath("adminsecret", "/admin"), "/admin");
  // Both reach the moderator queue and the shared sign-in page.
  assert.equal(m.resolveInternalPath("modsecret", "/moderator"), "/moderator");
  assert.equal(m.resolveInternalPath("adminsecret", "/moderator"), "/moderator");
  assert.equal(m.resolveInternalPath("modsecret", "/staff/login"), "/staff/login");
  assert.equal(m.resolveInternalPath("adminsecret", "/staff/login"), "/staff/login");
  // A wrong slug reaches nothing.
  assert.equal(m.resolveInternalPath("guess", "/moderator"), null);
  // A non-staff path is never reachable through a secret prefix.
  assert.equal(m.resolveInternalPath("adminsecret", "/chat"), null);
});

test("one slug still covers both consoles", async () => {
  // Existing single-slug deployments must keep working unchanged.
  const m = await load("only", undefined);
  assert.equal(m.portalPrefix("admin"), "/only");
  assert.equal(m.portalPrefix("staff"), "/only");
  assert.equal(m.resolveInternalPath("only", "/admin"), "/admin");
});

test("each role's post-sign-in destination carries its own secret", async () => {
  // The bug this guards: sign-in resolved the destination in the browser,
  // from the slug in the page's own URL. A super admin signing in at the
  // moderator entrance was therefore sent to `/{moderatorSlug}/admin`,
  // which 404s — so the super admin console was unreachable.
  //
  // The server resolves it now, and it must pick the slug that guards the
  // area, not the one the operator happened to arrive through.
  const m = await load("modsecret", "adminsecret");

  assert.equal(m.staffPortalHref("/admin"), "/adminsecret/admin");
  assert.equal(m.staffPortalHref("/moderator"), "/modsecret/moderator");

  // Onboarding is on the shared staff surface and reachable from either.
  assert.equal(m.staffPortalHref("/staff/onboarding/mfa"), "/modsecret/staff/onboarding/mfa");

  // And the destination must never be the internal path.
  for (const role of ["/admin", "/moderator"]) {
    assert.notEqual(m.staffPortalHref(role), role, `${role} must be prefixed`);
  }
});

test("the sign-in entrance matches the area being entered", async () => {
  // `/staff/login` is served under both secrets. Resolving it by path
  // alone always picks the moderator one, which is what bounced a super
  // admin opening their own bookmark to the wrong entrance.
  const m = await load("modsecret", "adminsecret");

  assert.equal(m.portalPrefix(m.areaForPath("/admin")), "/adminsecret");
  assert.equal(m.portalPrefix(m.areaForPath("/admin/users")), "/adminsecret");
  assert.equal(m.portalPrefix(m.areaForPath("/moderator")), "/modsecret");
  assert.equal(m.portalPrefix(m.areaForPath("/staff/login")), "/modsecret");
  assert.equal(m.areaForPath("/chat"), null);
});
