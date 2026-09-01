import "server-only";
import { ForbiddenError } from "@/auth/errors";
import type { Profile } from "@/auth/session";

/**
 * The authorization matrix.
 *
 * This is the only place that decides what a role may do. Every
 * privileged server action and route handler calls `assertPermission`
 * (or `assertCanActOn`) against the profile it loaded *server-side from
 * the database* — never against a role sent by the browser.
 *
 * Two portals sit on top of this matrix:
 *   /admin      — super_admin only
 *   /moderator  — moderator and super_admin
 *
 * A moderator is not a junior super admin. They can review accounts and
 * apply account-level moderation; they cannot touch billing, providers,
 * models, plans, system configuration, roles, or the system prompt, and
 * they cannot act on an administrator at all.
 */

export type Role = "user" | "moderator" | "super_admin";

export const ROLES: Role[] = ["user", "moderator", "super_admin"];

/** Roles that may reach a staff portal at all. */
export const STAFF_ROLES: Role[] = ["moderator", "super_admin"];

const SUPER_ADMIN_ONLY = ["super_admin"] as const;
const STAFF = ["moderator", "super_admin"] as const;

export const ADMIN_ACTIONS = {
  // ---- Users -------------------------------------------------------
  "users.view": STAFF,
  "users.search": STAFF,
  "users.view_detail": STAFF,
  "users.suspend": STAFF,
  "users.restore": STAFF,
  "users.disable": SUPER_ADMIN_ONLY,
  "users.delete": SUPER_ADMIN_ONLY,
  // Both roles. The link goes to the account holder's own registered
  // address and grants the operator nothing — they never see the password
  // and cannot set one. Withholding it only meant support had to escalate
  // the single most common request there is.
  "users.reset_password": STAFF,
  // Still super admin only, and the distinction is deliberate. A recovery
  // link asks the recipient to prove they can choose a new password; a
  // magic link *is* a session. Same inbox, but one of them is a way in.
  "users.send_magic_link": SUPER_ADMIN_ONLY,
  "users.send_verification": STAFF,
  "users.modify_role": SUPER_ADMIN_ONLY,
  // Creating an ordinary account. Distinct from `moderators.create`,
  // which mints staff — this cannot set a role, so the worst a misuse can
  // do is add an unprivileged account, and undo removes it.
  "users.invite": STAFF,
  // Reading the account's history: who acted on it and when. Separate
  // from `users.view_detail` because the history names other operators,
  // which is more than "look up this customer" implies.
  "users.view_activity": STAFF,
  // Ending every live session for an account. The support answer to "I
  // think someone else is signed in as me" — it destroys no data and the
  // account holder simply signs in again.
  "users.revoke_sessions": STAFF,

  // ---- Moderators --------------------------------------------------
  "moderators.create": SUPER_ADMIN_ONLY,
  "moderators.remove": SUPER_ADMIN_ONLY,
  // Full account reset: new temporary password, authenticator cleared,
  // sessions revoked. This is the recovery path for a moderator who has
  // lost their authenticator — without it they are locked out for good,
  // because enrolment is mandatory and only they could complete it.
  "moderators.reset": SUPER_ADMIN_ONLY,

  // ---- Complimentary access ----------------------------------------
  // Both roles: this is a support gesture (an apology for an outage, a
  // trial for a prospect), not a billing change. It cannot alter prices
  // or take payment, and every grant is audited with an expiry.
  "subscriptions.grant": STAFF,

  // ---- Usage & quotas ----------------------------------------------
  "usage.view": STAFF,
  "usage.view_user": STAFF,
  // Resetting one user's counter is a support action: someone was metered
  // for a request that failed, and an operator gives it back. It is
  // narrow, attributable and audited.
  "usage.reset_user": SUPER_ADMIN_ONLY,
  // `usage.reset_all` used to sit here. It zeroed every account's counters
  // at once, which is not a support action — it is a silent, unbounded
  // grant of free capacity across the whole platform, with no way to
  // undo it and no way to tell afterwards who had actually used what.
  // Every real need it covered (an outage that consumed quota unfairly) is
  // better served by raising the entitlement for the affected window,
  // which is visible in the plan and reversible. Removed rather than
  // hidden: a permission nothing grants is a permission nobody can be
  // tricked into exercising.
  "usage.override": SUPER_ADMIN_ONLY,
  // Deliberately narrower than `usage.override`. Moderators handle the
  // support cases where someone needs to attach more files to one
  // message, and that is a low-consequence limit — but letting them raise
  // *any* quota would hand them the billing controls by the back door, so
  // this is its own permission covering one feature key.
  "usage.override_attachments": STAFF,

  // ---- AI configuration --------------------------------------------
  "models.view": STAFF,
  "models.manage": SUPER_ADMIN_ONLY,
  "providers.view": SUPER_ADMIN_ONLY,
  "providers.manage": SUPER_ADMIN_ONLY,
  "system_prompt.view": SUPER_ADMIN_ONLY,
  "system_prompt.manage": SUPER_ADMIN_ONLY,

  // ---- Billing -----------------------------------------------------
  "plans.view": SUPER_ADMIN_ONLY,
  "plans.manage": SUPER_ADMIN_ONLY,
  "subscriptions.view": SUPER_ADMIN_ONLY,
  "subscriptions.manage": SUPER_ADMIN_ONLY,

  // ---- Email templates ---------------------------------------------
  // Super admin only, and not because moderators cannot write: these are
  // the words the platform sends from its own domain to every customer.
  // A bad edit is a phishing email with real headers behind it.
  "email_templates.view": SUPER_ADMIN_ONLY,
  "email_templates.manage": SUPER_ADMIN_ONLY,

  // ---- Platform configuration --------------------------------------
  "feature_flags.view": SUPER_ADMIN_ONLY,
  "feature_flags.manage": SUPER_ADMIN_ONLY,
  "system_settings.view": SUPER_ADMIN_ONLY,
  "system_settings.manage": SUPER_ADMIN_ONLY,

  // ---- Oversight ---------------------------------------------------
  "audit_logs.view": SUPER_ADMIN_ONLY,
  "moderation.view": STAFF,
  "moderation.act": STAFF,
  "moderation.note": STAFF,
} as const;

export type AdminAction = keyof typeof ADMIN_ACTIONS;

export function can(profile: Pick<Profile, "role">, action: AdminAction): boolean {
  const allowed = ADMIN_ACTIONS[action] as readonly string[];
  return allowed.includes(profile.role);
}

/** Throws ForbiddenError if the profile's role is not permitted for `action`. */
export function assertPermission(profile: Pick<Profile, "role">, action: AdminAction) {
  if (!can(profile, action)) {
    throw new ForbiddenError(`Role '${profile.role}' is not permitted to perform '${action}'`);
  }
}

export interface ActorTarget {
  id: string;
  role: Role;
}

/**
 * Guards *who* an action may be aimed at, on top of whether the actor may
 * perform it at all.
 *
 * Three rules the role matrix alone cannot express:
 *
 *  1. A moderator may never act on staff. Without this a moderator could
 *     suspend a super admin and lock the platform's owners out — the
 *     matrix says "moderators may suspend users", and a super admin is
 *     technically a row in the same table.
 *  2. Nobody may aim a destructive action at their own account. Deleting
 *     or disabling yourself is never a deliberate administrative act, and
 *     for the last super admin it is unrecoverable from the UI.
 *  3. Only a super admin may act on another super admin, and role changes
 *     to a super admin are refused outright — demotions go through the
 *     bootstrap script, which enforces the "never lose the last super
 *     admin" rule (also enforced by a database trigger).
 */
export function assertCanActOn(
  actor: Pick<Profile, "id" | "role">,
  target: ActorTarget,
  action: AdminAction,
) {
  assertPermission(actor, action);

  const targetIsStaff = target.role === "moderator" || target.role === "super_admin";

  if (actor.role !== "super_admin" && targetIsStaff) {
    throw new ForbiddenError("Moderators cannot perform administrative actions on staff accounts");
  }

  const isDestructive =
    action === "users.delete" ||
    action === "users.disable" ||
    action === "users.suspend" ||
    action === "users.modify_role";

  if (isDestructive && actor.id === target.id) {
    throw new ForbiddenError("You cannot perform this action on your own account");
  }

  if (target.role === "super_admin" && action === "users.modify_role") {
    throw new ForbiddenError(
      "A Super Admin's role cannot be changed from the console. Use scripts/super-admin.ts.",
    );
  }
}

/** Convenience for rendering: which portal, if any, a role may enter. */
export function portalFor(role: Role): "/admin" | "/moderator" | null {
  if (role === "super_admin") return "/admin";
  if (role === "moderator") return "/moderator";
  return null;
}
