import "server-only";
import { redirect } from "next/navigation";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { ForbiddenError } from "@/auth/errors";
import { requiresMfaEachSignIn } from "@/lib/settings";
import type { Profile } from "@/auth/session";
import { staffPortalHref } from "@/auth/portal-path";

/**
 * The onboarding and MFA gate for staff.
 *
 * Staff accounts must satisfy three conditions before they can do
 * anything privileged:
 *
 *   1. A temporary password has been replaced.
 *   2. An authenticator app is enrolled.
 *   3. **This session** was verified with it (`aal2`).
 *
 * ## Why the session, not the account
 *
 * Enrolment is a property of the *account*; verification is a property of
 * the *session*. Checking only "has a factor enrolled" would let someone
 * holding a stolen password sign in and reach the console without ever
 * touching the second factor — which makes the factor decorative. Supabase
 * reports the distinction as an assurance level: `aal1` is password-only,
 * `aal2` means a factor was verified in this session.
 *
 * ## Why this is enforced in two places
 *
 * Pages redirect (you can be sent to finish signing in). Server actions and
 * route handlers cannot redirect usefully, so they throw. Both call the
 * same `staffGateStatus`, because a gate that pages enforce and actions do
 * not is not a gate: an un-verified session could POST directly to
 * `suspendUserAction` while the console politely bounced it to a login
 * screen.
 */

export type StaffGateStatus = "ok" | "password" | "enroll" | "stepup";

export async function staffGateStatus(profile: Profile): Promise<StaffGateStatus> {
  if (profile.must_change_password) return "password";

  // Enrolment is recorded by the server after it confirmed with Supabase
  // that a *verified* factor exists — a client claiming to have enrolled
  // is not evidence.
  if (!profile.mfa_enrolled_at) return "enroll";

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();

  // Fail closed. An assurance level this code cannot read is not evidence
  // that a second factor was used.
  if (error) return "stepup";

  // `nextLevel` is aal2 only while the account actually has a verified
  // factor. If the flag says enrolled but no factor exists, the factor was
  // removed — by `super-admin recover` after a lost authenticator, or by an
  // administrator resetting the account.
  //
  // Sending them to *enrol* rather than to a challenge is what makes the
  // break-glass path work: trusting the flag alone would demand a code from
  // an account that has nothing left to generate one with, which is a
  // permanent lockout that survives recovery.
  if (data.nextLevel !== "aal2") return "enroll";

  // Step-up can be relaxed deliberately, but never silently: the setting
  // is visible in the console and defaults to on.
  if (!(await requiresMfaEachSignIn())) return "ok";

  if (data.currentLevel !== "aal2") return "stepup";

  return "ok";
}

/** Page guard: sends the operator wherever they need to go next. */
export async function requireStaffGate(profile: Profile, locale: string): Promise<void> {
  const status = await staffGateStatus(profile);
  if (status === "ok") return;

  if (status === "password") redirect(staffPortalHref("/staff/onboarding/password", locale));
  if (status === "enroll") redirect(staffPortalHref("/staff/onboarding/mfa", locale));
  redirect(`${staffPortalHref("/staff/login", locale)}?step=mfa`);
}

/**
 * Action and route guard: refuses outright.
 *
 * There is nowhere to redirect a POST to, and a privileged action is not
 * something to let through with a warning.
 */
export async function assertStaffGate(profile: Profile): Promise<void> {
  const status = await staffGateStatus(profile);
  if (status === "ok") return;

  throw new ForbiddenError(
    status === "password"
      ? "Set your own password before using the console."
      : status === "enroll"
        ? "Enrol an authenticator app before using the console."
        : "This session has not been verified with your authenticator.",
  );
}
