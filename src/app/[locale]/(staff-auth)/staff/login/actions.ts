"use server";

import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { recordAuditEvent } from "@/admin/audit";
import { requiresMfaEachSignIn } from "@/lib/settings";
import { recordSessionLocation } from "@/auth/session-location";
import { headers } from "next/headers";
import { portalFor, type Role } from "@/admin/permissions";
import { staffPortalHref } from "@/auth/portal-path";
import { logger } from "@/lib/logger";

export interface StaffAuthResult {
  ok: boolean;
  /** Message key under the `staffAuth.errors` namespace. */
  error?: "invalidCredentials" | "notStaff" | "rateLimited" | "inactive" | "wrongEntrance";
  /** Where to send the operator once authenticated. */
  /**
   * Where to go next, **already carrying the right secret prefix**.
   *
   * The server computes this, not the browser. The two consoles have
   * separate secrets, and only the server knows which one this account is
   * entitled to — a page can only see the slug in its own URL, so a super
   * admin who signed in at the moderator entrance would otherwise be sent
   * to `/{moderatorSlug}/admin`, which 404s. That was the bug.
   */
  portal?: string;
  /**
   * The account has an authenticator enrolled, so the form must collect a
   * code before navigating — a password alone leaves the session at aal1
   * and every staff page would bounce it back here.
   */
  requiresMfa?: boolean;
  /**
   * The verified TOTP factor to challenge.
   *
   * Read here, while authenticating, rather than looked up again in the
   * browser: a client-side lookup that failed for any reason was being
   * reported as "no authenticator is set up" on accounts that had one.
   * Not a secret — it names a factor whose codes only its holder can
   * produce — and it is only ever returned to the account that owns it.
   */
  mfaFactorId?: string;
}

const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(1).max(200);

/**
 * Staff sign-in.
 *
 * Separate from the customer flow on purpose, and stricter in three ways:
 *
 *  - **Tighter throttle.** Five attempts a minute per IP rather than
 *    fifteen. These accounts can change every other account's access, so
 *    the brute-force budget should not be the same.
 *  - **Every attempt is audited**, success or failure. A failed customer
 *    sign-in is noise; a failed *administrator* sign-in is a signal.
 *  - **A non-staff account is signed straight back out.** Authenticating
 *    correctly here is not enough — the session is discarded unless the
 *    profile actually carries a staff role, so this endpoint can never
 *    become a second way into the customer app.
 */
export async function staffSignInAction(
  _previous: StaffAuthResult,
  formData: FormData,
): Promise<StaffAuthResult> {
  const ip = await getClientIp();
  const { allowed } = checkRateLimit(`staff-signin:${ip}`, 5, 60_000);
  if (!allowed) return { ok: false, error: "rateLimited" };

  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));

  if (!email.success || !password.success) {
    return { ok: false, error: "invalidCredentials" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: password.data,
  });

  if (error || !data.user) {
    logger.warn("staff_signin_failed", { reason: "credentials" });
    await recordAuditEvent({
      actorId: null,
      action: "staff.signin_failed",
      targetType: "email",
      targetId: email.data,
      result: "failure",
      metadata: { reason: "invalid_credentials" },
    });
    return { ok: false, error: "invalidCredentials" };
  }

  const { data: profile } = await supabase
    .from("profiles")
    .select("role, status, must_change_password, mfa_enrolled_at")
    .eq("id", data.user.id)
    .maybeSingle();

  const portal = profile ? portalFor(profile.role as Role) : null;

  // Each entrance admits only its own role.
  //
  // The two consoles have separate secrets so that knowing one does not
  // reveal the other. Letting either role sign in at either entrance
  // undoes that: a moderator who reached the admin URL would have it
  // confirmed as a working staff entrance, and the operator would have no
  // signal that they were somewhere they should not be.
  //
  // The area comes from a header the middleware sets from the secret the
  // request arrived through — never from the browser, which cannot state
  // its own. Read here rather than passed through the form for the same
  // reason.
  //
  // This is a *routing* rule, not the authorization boundary: the role
  // matrix and the portal guards still decide what anyone may do. It
  // exists so the two doors stay genuinely separate.
  const entranceArea = (await headers()).get("x-portal-area");
  if (portal && entranceArea) {
    const expected = portal === "/admin" ? "admin" : "staff";
    if (entranceArea !== expected) {
      await supabase.auth.signOut();

      await recordAuditEvent({
        actorId: data.user.id,
        action: "staff.signin_denied",
        targetType: "user",
        targetId: data.user.id,
        result: "failure",
        metadata: { reason: "wrong_entrance", role: profile?.role ?? null, entrance: entranceArea },
      });

      return { ok: false, error: "wrongEntrance" };
    }
  }

  // Authenticated, but not staff — or staff whose account is not active.
  // Either way the session does not survive this request.
  if (!portal || profile?.status !== "active") {
    await supabase.auth.signOut();

    await recordAuditEvent({
      actorId: data.user.id,
      action: "staff.signin_denied",
      targetType: "user",
      targetId: data.user.id,
      result: "failure",
      metadata: { role: profile?.role ?? null, status: profile?.status ?? null },
    });

    return { ok: false, error: portal ? "inactive" : "notStaff" };
  }

  await recordAuditEvent({
    actorId: data.user.id,
    action: "staff.signin",
    targetType: "user",
    targetId: data.user.id,
    metadata: { role: profile.role, portal },
  });

  if (data.session) {
    await recordSessionLocation(data.user.id, data.session.access_token);
  }

  // Onboarding takes precedence over the portal. An account holding a
  // temporary password, or with no authenticator yet, is sent to finish
  // setting itself up — the portal guards would bounce it straight back
  // anyway, and landing on the right screen is friendlier than a redirect
  // chain.
  // Onboarding lives on the staff surface, reachable from either secret.
  if (profile.must_change_password) {
    return { ok: true, portal: staffPortalHref("/staff/onboarding/password") };
  }
  if (!profile.mfa_enrolled_at) {
    return { ok: true, portal: staffPortalHref("/staff/onboarding/mfa") };
  }

  // Enrolled. Whether a code is collected now depends on the step-up
  // setting: with it off (the default) enrolling once was the whole
  // requirement, and asking again on every sign-in was the thing that made
  // the console feel like it kept demanding MFA setup.
  // `portal` is "/admin" or "/moderator"; `staffPortalHref` picks the
  // secret that guards that area, which is the whole point of resolving
  // it here rather than in the browser.
  const destination = staffPortalHref(portal);

  if (await requiresMfaEachSignIn()) {
    const { data: factors } = await supabase.auth.mfa.listFactors();
    const verified = (factors?.totp ?? []).find((factor) => factor.status === "verified");
    return { ok: true, portal: destination, requiresMfa: true, mfaFactorId: verified?.id };
  }
  return { ok: true, portal: destination };
}
