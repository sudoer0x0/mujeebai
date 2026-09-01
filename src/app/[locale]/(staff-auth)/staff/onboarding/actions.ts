"use server";

import { z } from "zod";
import { requireUser, getCurrentProfile } from "@/auth/session";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { recordAuditEvent } from "@/admin/audit";
import { logger } from "@/lib/logger";

/**
 * Staff onboarding: replace the temporary password, then enrol a factor.
 *
 * Both steps are server actions rather than client calls to Supabase,
 * because both need to write `profiles` columns that a browser is
 * deliberately forbidden from touching (see migration 0015).
 */

export interface OnboardingResponse {
  ok: boolean;
  message: string;
}

const passwordSchema = z
  .object({
    password: z.string().min(12).max(200),
    confirm: z.string(),
  })
  .refine((value) => value.password === value.confirm, { path: ["confirm"] });

/**
 * Sets the operator's own password and clears the temporary-password flag.
 *
 * 12 characters minimum rather than the customer minimum: this account can
 * suspend users, change prices and read the audit log.
 */
export async function setStaffPasswordAction(input: unknown): Promise<OnboardingResponse> {
  try {
    const user = await requireUser();
    const profile = await getCurrentProfile();
    if (!profile || (profile.role !== "moderator" && profile.role !== "super_admin")) {
      return { ok: false, message: "staffAuth.onboarding.notStaff" };
    }

    const parsed = passwordSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "staffAuth.onboarding.passwordInvalid" };

    // Updated through the caller's own session so Supabase applies its
    // own password policy and revokes other sessions as configured.
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.updateUser({ password: parsed.data.password });

    if (error) {
      // Supabase refuses a password identical to the current one, which
      // is exactly the "change" an invitee might try.
      return { ok: false, message: "staffAuth.onboarding.passwordRejected" };
    }

    const admin = createServiceRoleClient();
    await admin
      .from("profiles")
      .update({ must_change_password: false, password_changed_at: new Date().toISOString() })
      .eq("id", user.id);

    await recordAuditEvent({
      actorId: user.id,
      action: "staff.password_set",
      targetType: "user",
      targetId: user.id,
      result: "success",
      metadata: {},
    });

    return { ok: true, message: "staffAuth.onboarding.passwordSaved" };
  } catch (error) {
    logger.error("staff_password_set_failed", { error: String(error) });
    return { ok: false, message: "staffAuth.onboarding.passwordRejected" };
  }
}

/**
 * Records that enrolment finished.
 *
 * The TOTP enrol/verify handshake itself happens in the browser against
 * Supabase — the QR code and the secret must reach the operator's screen
 * and nowhere else, and routing them through this server would mean
 * logging a shared secret. What the server does is confirm, using its own
 * view of the account, that a *verified* factor actually exists before
 * stamping `mfa_enrolled_at`. A client claiming to have enrolled is not
 * evidence.
 */
export async function confirmMfaEnrolledAction(): Promise<OnboardingResponse> {
  try {
    const user = await requireUser();
    const supabase = await createServerSupabaseClient();

    const { data, error } = await supabase.auth.mfa.listFactors();
    if (error) return { ok: false, message: "staffAuth.onboarding.mfaFailed" };

    const verified = (data?.totp ?? []).some((factor) => factor.status === "verified");
    if (!verified) return { ok: false, message: "staffAuth.onboarding.mfaNotVerified" };

    const admin = createServiceRoleClient();
    await admin
      .from("profiles")
      .update({ mfa_enrolled_at: new Date().toISOString() })
      .eq("id", user.id);

    await recordAuditEvent({
      actorId: user.id,
      action: "staff.mfa_enrolled",
      targetType: "user",
      targetId: user.id,
      result: "success",
      metadata: {},
    });

    return { ok: true, message: "staffAuth.onboarding.mfaEnrolled" };
  } catch (error) {
    logger.error("staff_mfa_confirm_failed", { error: String(error) });
    return { ok: false, message: "staffAuth.onboarding.mfaFailed" };
  }
}
