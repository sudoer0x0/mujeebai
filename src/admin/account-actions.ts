"use server";

import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/admin/audit";
import { checkRateLimit } from "@/lib/rate-limit";
import { clientEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { Database } from "@/types/database";
import type { ActionResponse } from "@/admin/user-actions";

/**
 * A staff member acting on their *own* account.
 *
 * Distinct from `user-actions.ts`, which is one operator acting on
 * somebody else and is gated by the role matrix. Everything here is
 * self-service: the only authorization needed is "you are staff and this
 * is your account", so these deliberately take no target id. An action
 * that cannot name a victim cannot be pointed at one.
 */

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  // Same floor as staff onboarding. Staff passwords are held to a longer
  // minimum than customer ones because the blast radius is the platform.
  newPassword: z.string().min(12).max(200),
});

/**
 * Changes the signed-in operator's password.
 *
 * ## Why the current password is required
 *
 * Supabase will change a password from a valid session alone. That is
 * fine for a customer, and not fine here: an unattended console, a stolen
 * session cookie, or an XSS payload would otherwise be enough to lock the
 * real owner out of an administrative account. Asking for the current
 * password means possession of the session is not sufficient.
 *
 * ## Why it is verified on a throwaway client
 *
 * `signInWithPassword` issues a *new* session and would overwrite the
 * caller's cookies — including dropping them back to `aal1`, since a
 * fresh password sign-in has not been stepped up with an authenticator.
 * The operator would silently lose their MFA assurance by changing their
 * password. Verifying on a client with no cookie storage checks the
 * credential and throws the resulting session away.
 */
export async function changeStaffPasswordAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();

    // Verifying the current password makes this a credential oracle: an
    // attacker on a hijacked console session could otherwise guess at the
    // real password here as fast as the network allows. Supabase applies
    // its own sign-in limits, but this is the cheaper and more specific
    // place to stop it, and it bounds the noise in the audit log too.
    const { allowed } = checkRateLimit(`staff-password-change:${actor.id}`, 5, 15 * 60_000);
    if (!allowed) return { ok: false, message: "admin.security.passwordThrottled" };

    const parsed = changePasswordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.security.passwordInvalid" };
    if (!actor.email) return { ok: false, message: "admin.security.passwordFailed" };

    if (parsed.data.currentPassword === parsed.data.newPassword) {
      return { ok: false, message: "admin.security.passwordSame" };
    }

    const verifier = createClient<Database>(
      clientEnv.NEXT_PUBLIC_SUPABASE_URL,
      clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { autoRefreshToken: false, persistSession: false } },
    );

    const { error: verifyError } = await verifier.auth.signInWithPassword({
      email: actor.email,
      password: parsed.data.currentPassword,
    });

    if (verifyError) {
      // Audited: repeated failures here are how an attacker on a hijacked
      // session looks, and that is worth being able to see afterwards.
      await recordAuditEvent({
        actorId: actor.id,
        action: "staff.password_change_failed",
        targetType: "user",
        targetId: actor.id,
        result: "failure",
      });
      return { ok: false, message: "admin.security.passwordWrong" };
    }

    // Discard the verification session immediately rather than leaving a
    // second live refresh token for this account sitting in Supabase.
    await verifier.auth.signOut().catch(() => undefined);

    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.newPassword });

    if (error) {
      logger.warn("staff_password_change_rejected", { reason: error.message });
      return { ok: false, message: "admin.security.passwordRejected" };
    }

    const admin = createServiceRoleClient();
    await admin
      .from("profiles")
      .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
      .eq("id", actor.id);

    await recordAuditEvent({
      actorId: actor.id,
      action: "staff.password_changed",
      targetType: "user",
      targetId: actor.id,
      result: "success",
    });

    return { ok: true, message: "admin.security.passwordChanged" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("staff_password_change_failed", { error: String(error) });
    return { ok: false, message: "admin.security.passwordFailed" };
  }
}
