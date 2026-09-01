"use server";

import { revalidatePath } from "next/cache";
import { requireUser, getCurrentProfile } from "@/auth/session";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/admin/audit";
import { logger } from "@/lib/logger";

/**
 * Session visibility and revocation for staff accounts.
 *
 * ## Scope
 *
 * This covers the account-level facts: two-factor state, the assurance
 * level of the session making the request, last sign-in, and the
 * revoke-everywhere control.
 *
 * The per-device list lives in `src/auth/device-sessions.ts`. An earlier
 * version of this comment claimed such a list could not be obtained from
 * Supabase — that was wrong. `auth.sessions` carries `user_agent`, `ip`
 * and `refreshed_at` per session; it is simply not reachable through
 * PostgREST or the admin API, which is what migration 0022 addresses.
 */

export interface SessionInfo {
  currentSessionSince: string | null;
  lastSignInAt: string | null;
  mfaEnrolled: boolean;
  /** Assurance level of the session making this request. */
  assuranceLevel: string | null;
}

export async function getSessionInfoAction(): Promise<SessionInfo> {
  const user = await requireUser();
  const supabase = await createServerSupabaseClient();

  const [{ data: sessionData }, { data: aal }] = await Promise.all([
    supabase.auth.getSession(),
    supabase.auth.mfa.getAuthenticatorAssuranceLevel(),
  ]);

  const admin = createServiceRoleClient();
  const [{ data: authUser }, { data: profile }] = await Promise.all([
    admin.auth.admin.getUserById(user.id),
    admin.from("profiles").select("mfa_enrolled_at").eq("id", user.id).maybeSingle(),
  ]);

  return {
    // `expires_at` is seconds since epoch for the *access* token; the
    // issued-at is the useful half for "since when".
    currentSessionSince: sessionData.session?.expires_at
      ? new Date((sessionData.session.expires_at - (sessionData.session.expires_in ?? 3600)) * 1000).toISOString()
      : null,
    lastSignInAt: authUser?.user?.last_sign_in_at ?? null,
    mfaEnrolled: Boolean(profile?.mfa_enrolled_at),
    assuranceLevel: aal?.currentLevel ?? null,
  };
}

/**
 * Revokes every session for the calling account, including this one.
 *
 * `scope: "global"` rather than "others": someone reaching for this
 * control has usually lost track of where they are signed in, and leaving
 * the current browser authenticated means a stolen laptop that is *this*
 * browser stays signed in. Signing out everywhere and back in once is the
 * behaviour the control promises.
 */
export async function signOutEverywhereAction(): Promise<{ ok: boolean }> {
  try {
    const user = await requireUser();
    const profile = await getCurrentProfile();

    const admin = createServiceRoleClient();
    const { error } = await admin.auth.admin.signOut(user.id, "global");

    await recordAuditEvent({
      actorId: user.id,
      action: "staff.sessions_revoked",
      targetType: "user",
      targetId: user.id,
      result: error ? "failure" : "success",
      metadata: { role: profile?.role ?? null },
    });

    if (error) {
      logger.error("sign_out_everywhere_failed", { error: error.message });
      return { ok: false };
    }

    // Clear this request's cookies too, so the browser does not keep
    // presenting a token the server has already invalidated.
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();

    revalidatePath("/", "layout");
    return { ok: true };
  } catch (error) {
    logger.error("sign_out_everywhere_unexpected", { error: String(error) });
    return { ok: false };
  }
}
