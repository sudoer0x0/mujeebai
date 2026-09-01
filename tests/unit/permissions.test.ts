import test from "node:test";
import assert from "node:assert/strict";
import {
  can,
  assertPermission,
  assertCanActOn,
  portalFor,
  ADMIN_ACTIONS,
  type AdminAction,
} from "@/admin/permissions";
// From @/auth/errors, not @/auth/session: importing the session module
// here would pull in Supabase, next/navigation and environment validation
// to test a pure lookup table.
import { ForbiddenError } from "@/auth/errors";

const SUPER_ADMIN = { id: "11111111-1111-1111-1111-111111111111", role: "super_admin" as const };
const MODERATOR = { id: "22222222-2222-2222-2222-222222222222", role: "moderator" as const };
const USER = { id: "33333333-3333-3333-3333-333333333333", role: "user" as const };

test("super_admin can perform every action in the matrix", () => {
  for (const action of Object.keys(ADMIN_ACTIONS) as AdminAction[]) {
    assert.equal(can(SUPER_ADMIN, action), true, `super_admin should be able to ${action}`);
    assert.doesNotThrow(() => assertPermission(SUPER_ADMIN, action));
  }
});

test("a standard user is denied every action in the matrix", () => {
  for (const action of Object.keys(ADMIN_ACTIONS) as AdminAction[]) {
    assert.equal(can(USER, action), false, `a user must be forbidden from ${action}`);
    assert.throws(() => assertPermission(USER, action), ForbiddenError);
  }
});

test("moderators may review accounts and moderate, and nothing else", () => {
  const allowed: AdminAction[] = [
    "users.view",
    "users.search",
    "users.view_detail",
    "users.suspend",
    "users.restore",
    "users.send_verification",
    // Widened deliberately: a moderator can now invite ordinary accounts,
    // read an account's history, send a password-reset link and end live
    // sessions. Each is either unprivileged or reversible, and none of
    // them can change a role.
    "users.invite",
    "users.view_activity",
    "users.reset_password",
    "users.revoke_sessions",
    "usage.view",
    "usage.view_user",
    "models.view",
    "moderation.view",
    "moderation.act",
    "moderation.note",
  ];

  for (const action of allowed) {
    assert.equal(can(MODERATOR, action), true, `moderator should be allowed to ${action}`);
    assert.doesNotThrow(() => assertPermission(MODERATOR, action));
  }

  const forbidden: AdminAction[] = [
    "users.delete",
    "users.disable",
    // Still forbidden, and the contrast with `users.reset_password` above
    // is the point: a reset link asks the recipient to prove themselves,
    // a magic link is a session handed over.
    "users.send_magic_link",
    "users.modify_role",
    "moderators.create",
    "moderators.remove",
    "usage.reset_user",
    "usage.override",
    "models.manage",
    "providers.view",
    "providers.manage",
    "plans.view",
    "plans.manage",
    "subscriptions.view",
    "subscriptions.manage",
    "system_prompt.view",
    "system_prompt.manage",
    "feature_flags.view",
    "feature_flags.manage",
    "system_settings.view",
    "system_settings.manage",
    "audit_logs.view",
  ];

  for (const action of forbidden) {
    assert.equal(can(MODERATOR, action), false, `moderator must be forbidden from ${action}`);
    assert.throws(() => assertPermission(MODERATOR, action), ForbiddenError, `expected ForbiddenError for ${action}`);
  }
});

test("every action in the matrix names at least one role", () => {
  // A typo'd role list would silently make an action unreachable rather
  // than failing anywhere obvious.
  for (const [action, roles] of Object.entries(ADMIN_ACTIONS)) {
    assert.ok((roles as readonly string[]).length > 0, `${action} has no roles`);
    for (const role of roles as readonly string[]) {
      assert.ok(["moderator", "super_admin"].includes(role), `${action} names unknown role '${role}'`);
    }
  }
});

test("a moderator cannot act on staff accounts", () => {
  assert.throws(
    () => assertCanActOn(MODERATOR, { id: SUPER_ADMIN.id, role: "super_admin" }, "users.suspend"),
    ForbiddenError,
    "a moderator must not be able to suspend a super admin",
  );

  assert.throws(
    () => assertCanActOn(MODERATOR, { id: "44444444-4444-4444-4444-444444444444", role: "moderator" }, "users.suspend"),
    ForbiddenError,
    "a moderator must not be able to suspend another moderator",
  );

  assert.doesNotThrow(() => assertCanActOn(MODERATOR, { id: USER.id, role: "user" }, "users.suspend"));
});

test("nobody can aim a destructive action at their own account", () => {
  for (const action of ["users.delete", "users.disable", "users.suspend", "users.modify_role"] as AdminAction[]) {
    assert.throws(
      () => assertCanActOn(SUPER_ADMIN, { id: SUPER_ADMIN.id, role: "super_admin" }, action),
      ForbiddenError,
      `${action} must be refused against one's own account`,
    );
  }
});

test("a super admin's role cannot be changed from the console", () => {
  assert.throws(
    () =>
      assertCanActOn(
        SUPER_ADMIN,
        { id: "55555555-5555-5555-5555-555555555555", role: "super_admin" },
        "users.modify_role",
      ),
    ForbiddenError,
  );
});

test("a super admin can act on ordinary and moderator accounts", () => {
  assert.doesNotThrow(() => assertCanActOn(SUPER_ADMIN, { id: USER.id, role: "user" }, "users.delete"));
  assert.doesNotThrow(() => assertCanActOn(SUPER_ADMIN, { id: MODERATOR.id, role: "moderator" }, "users.modify_role"));
});

test("portalFor routes each role to its own console", () => {
  assert.equal(portalFor("super_admin"), "/admin");
  assert.equal(portalFor("moderator"), "/moderator");
  assert.equal(portalFor("user"), null);
});

test("an invite cannot be used to create staff", () => {
  // `users.invite` is held by moderators. If it could ever set a role it
  // would be a privilege-escalation path, so the guard is that granting
  // a role is a separate permission moderators do not hold.
  assert.equal(can(MODERATOR, "users.invite"), true);
  assert.equal(can(MODERATOR, "users.modify_role"), false);
  assert.equal(can(MODERATOR, "moderators.create"), false);
});

test("moderators cannot aim the widened user powers at staff", () => {
  const staffTargets = [
    { id: "44444444-4444-4444-4444-444444444444", role: "moderator" as const },
    { id: "55555555-5555-5555-5555-555555555555", role: "super_admin" as const },
  ];

  for (const target of staffTargets) {
    for (const action of ["users.reset_password", "users.revoke_sessions", "users.suspend"] as AdminAction[]) {
      assert.throws(
        () => assertCanActOn(MODERATOR, target, action),
        ForbiddenError,
        `moderator must not ${action} a ${target.role}`,
      );
    }
  }
});

test("a super admin can reverse a moderator's invite, and a moderator cannot", () => {
  // Undo authorization is the permission the *forward* action would need
  // now. Reversing an invite deletes the account, which is `users.delete`
  // — super-admin-only — so the asymmetry the console promises holds.
  assert.equal(can(SUPER_ADMIN, "users.delete"), true);
  assert.equal(can(MODERATOR, "users.delete"), false);
});
