"use server";
import { staffPortalHref } from "@/auth/portal-path";

import crypto from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { buildAuthEmail } from "@/notifications/templates/auth";
import { sendEmail } from "@/notifications";
import { clientEnv } from "@/lib/env";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

/**
 * Provisioning and removing moderators from the admin console.
 *
 * ## The shape of the flow
 *
 * A super admin enters an email address. This creates the account with a
 * generated temporary password, marks it `must_change_password`, emails
 * the credentials, and stops. The invitee cannot reach the moderator
 * console until they have:
 *
 *   1. signed in with the temporary password,
 *   2. chosen their own password, and
 *   3. enrolled an authenticator app.
 *
 * Steps 2 and 3 are enforced server-side in the staff layout, not by
 * hiding a link — see src/auth/staff-gate.ts.
 *
 * ## Why a temporary password rather than an invite link
 *
 * Both were viable. A password is what was asked for, and it has one real
 * advantage here: it is delivered to an address the super admin typed, so
 * an operator who mistypes the address gives away a credential that is
 * useless without also completing MFA enrolment on a second factor the
 * attacker would have to set up before the real invitee does. The window
 * is small and the audit log records the invite either way.
 */

const createSchema = z.object({
  email: z.string().email().max(200),
  displayName: z.string().trim().min(1).max(80).optional(),
  locale: z.string().min(2).max(5).default("en"),
});

/**
 * Generates a temporary password.
 *
 * `crypto.randomBytes` rather than `Math.random`: this value is a
 * credential, and a predictable one is the same as no password at all.
 * base64url keeps it copy-pasteable out of an email without escaping or
 * ambiguous characters being mangled by a mail client.
 */
function generateTemporaryPassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export async function createModeratorAction(input: unknown): Promise<ActionResponse & { email?: string }> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "moderators.create");

    const parsed = createSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.moderators.invalid" };

    const email = parsed.data.email.trim().toLowerCase();
    const admin = createServiceRoleClient();

    // Refuse to convert an existing account. Silently promoting whoever
    // happens to own that address — possibly a paying customer, possibly
    // someone whose address was mistyped — is a different and much more
    // consequential action than creating a new staff account, so it has
    // its own deliberate path (Users -> change role).
    const { data: existingProfile } = await admin
      .from("profiles")
      .select("id, role")
      .eq("email", email)
      .maybeSingle();

    if (existingProfile) {
      return { ok: false, message: "admin.moderators.alreadyExists" };
    }

    const temporaryPassword = generateTemporaryPassword();

    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password: temporaryPassword,
      // Confirmed on creation: the super admin vouched for this address,
      // and an unconfirmed staff account cannot sign in to complete the
      // onboarding this flow depends on.
      email_confirm: true,
    });

    if (createError || !created?.user) {
      logger.error("moderator_create_failed", { error: createError?.message });
      return { ok: false, message: "admin.moderators.createFailed" };
    }

    const userId = created.user.id;

    const { error: profileError } = await admin
      .from("profiles")
      .update({
        role: "moderator",
        display_name: parsed.data.displayName ?? email.split("@")[0],
        locale: parsed.data.locale,
        must_change_password: true,
        mfa_enrolled_at: null,
        invited_by: actor.id,
        invited_at: new Date().toISOString(),
      })
      .eq("id", userId);

    if (profileError) {
      // Roll back rather than leave an auth user with a `user` profile and
      // a password nobody knows.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      logger.error("moderator_profile_update_failed", { error: profileError.message });
      return { ok: false, message: "admin.moderators.createFailed" };
    }

    const message = await buildAuthEmail("staffInvite", {
      to: email,
      locale: parsed.data.locale,
      displayName: parsed.data.displayName,
      actionUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}${staffPortalHref("/staff/login", parsed.data.locale)}`,
      secret: {
        label: await staffInviteSecretLabel(parsed.data.locale),
        value: temporaryPassword,
      },
    });

    const delivery = await sendEmail(message);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.moderator_created",
      targetType: "user",
      targetId: userId,
      result: delivery.delivered ? "success" : "failure",
      // The password is deliberately absent from the audit metadata — an
      // audit log that records credentials is a credential store.
      metadata: { email, emailDelivered: delivery.delivered },
    });

    if (!delivery.delivered) {
      // The account exists and is a moderator, but nobody has the
      // password. Roll back so the super admin can simply try again
      // rather than having to clean up by hand.
      await admin.auth.admin.deleteUser(userId).catch(() => undefined);
      logger.error("moderator_invite_email_failed_rolled_back", { userId });
      return { ok: false, message: "admin.moderators.emailFailed" };
    }

    revalidatePath("/admin/moderators");
    revalidatePath("/admin/users");
    return { ok: true, message: "admin.moderators.created", email };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("moderator_create_unexpected", { error: String(error) });
    return { ok: false, message: "admin.moderators.createFailed" };
  }
}

async function staffInviteSecretLabel(locale: string): Promise<string> {
  const { getTranslations } = await import("next-intl/server");
  const t = await getTranslations({ locale, namespace: "emails.staffInvite" });
  return t("secretLabel");
}

const removeSchema = z.object({ userId: z.string().uuid() });

/**
 * Demotes a moderator back to an ordinary user.
 *
 * Deliberately a demotion and not a deletion: the account may own
 * conversations and a moderation history, and destroying that to revoke
 * access is a much larger action than the one being asked for. Deleting
 * the account remains available separately under `users.delete`.
 */
export async function removeModeratorAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "moderators.remove");

    const parsed = removeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.moderators.invalid" };

    const admin = createServiceRoleClient();
    const { data: target } = await admin
      .from("profiles")
      .select("id, role, email")
      .eq("id", parsed.data.userId)
      .maybeSingle();

    if (!target || target.role !== "moderator") {
      return { ok: false, message: "admin.moderators.notModerator" };
    }

    const { error } = await admin.from("profiles").update({ role: "user" }).eq("id", target.id);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.moderator_removed",
      targetType: "user",
      targetId: target.id,
      result: error ? "failure" : "success",
      metadata: { email: target.email },
    });

    if (error) return { ok: false, message: "admin.moderators.removeFailed" };

    // Their existing sessions still carry a valid token. Revoke them so
    // access ends now rather than whenever the token happens to expire.
    await admin.auth.admin.signOut(target.id, "global").catch(() => undefined);

    revalidatePath("/admin/moderators");
    revalidatePath("/admin/users");
    return { ok: true, message: "admin.moderators.removed" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("moderator_remove_unexpected", { error: String(error) });
    return { ok: false, message: "admin.moderators.removeFailed" };
  }
}

const resetSchema = z.object({ userId: z.string().uuid() });

/**
 * Full account reset for a staff member.
 *
 * ## Why this has to exist
 *
 * Authenticator enrolment is mandatory, and only the account holder can
 * complete it. So a moderator who loses their phone is locked out
 * permanently — the ordinary "send a password reset" does nothing, because
 * the gate they are stuck behind is the authenticator, not the password.
 *
 * This resets both halves at once: a new temporary password, the enrolled
 * factors removed, and every live session revoked. The account comes back
 * through the same door a new moderator does — set a password, enrol an
 * authenticator — so the recovery path is one the operator has already
 * seen work.
 *
 * Revoking sessions matters: if the account was lost rather than merely
 * locked out, leaving an old session alive would leave the attacker signed
 * in while the rightful owner resets around them.
 */
export async function resetModeratorAccountAction(input: unknown): Promise<ActionResponse & { email?: string }> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "moderators.reset");

    const parsed = resetSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.moderators.invalid" };

    const admin = createServiceRoleClient();
    const { data: target } = await admin
      .from("profiles")
      .select("id, email, role, locale, display_name")
      .eq("id", parsed.data.userId)
      .maybeSingle();

    if (!target?.email) return { ok: false, message: "admin.moderators.notModerator" };
    if (target.role !== "moderator" && target.role !== "super_admin") {
      return { ok: false, message: "admin.moderators.notModerator" };
    }
    // A super admin resetting themselves would lock the console: new
    // temporary password, no authenticator, and the session revoked mid-
    // request. Recovery for your own account is the CLI.
    if (target.id === actor.id) return { ok: false, message: "admin.moderators.cannotResetSelf" };

    const temporaryPassword = generateTemporaryPassword();

    const { error: authError } = await admin.auth.admin.updateUserById(target.id, {
      password: temporaryPassword,
    });
    if (authError) {
      logger.error("moderator_reset_password_failed", { error: authError.message });
      return { ok: false, message: "admin.moderators.resetFailed" };
    }

    // Remove enrolled factors so the next sign-in goes through enrolment
    // again. Supabase has no admin "unenroll all", so each is deleted by id.
    await removeAllFactors(target.id);

    const { error: profileError } = await admin
      .from("profiles")
      .update({ must_change_password: true, mfa_enrolled_at: null })
      .eq("id", target.id);

    if (profileError) {
      logger.error("moderator_reset_profile_failed", { error: profileError.message });
      return { ok: false, message: "admin.moderators.resetFailed" };
    }

    const message = await buildAuthEmail("staffInvite", {
      to: target.email,
      locale: target.locale ?? "en",
      displayName: target.display_name ?? undefined,
      actionUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}${staffPortalHref("/staff/login", target.locale ?? "en")}`,
      secret: { label: await staffInviteSecretLabel(target.locale ?? "en"), value: temporaryPassword },
    });
    const delivery = await sendEmail(message);

    // Revoke last: doing it before the email would be fine, but doing it
    // at all is the point — a lost account must not stay signed in.
    await admin.auth.admin.signOut(target.id, "global").catch(() => undefined);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.moderator_reset",
      targetType: "user",
      targetId: target.id,
      result: delivery.delivered ? "success" : "failure",
      metadata: { email: target.email, emailDelivered: delivery.delivered },
    });

    if (!delivery.delivered) return { ok: false, message: "admin.moderators.emailFailed" };

    revalidatePath("/admin/moderators");
    revalidatePath("/admin/users");
    return { ok: true, message: "admin.moderators.resetDone", email: target.email };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("moderator_reset_unexpected", { error: String(error) });
    return { ok: false, message: "admin.moderators.resetFailed" };
  }
}

/** Deletes every MFA factor on an account, so enrolment starts clean. */
async function removeAllFactors(userId: string): Promise<void> {
  const admin = createServiceRoleClient();
  try {
    const { data } = await admin.auth.admin.mfa.listFactors({ userId });
    for (const factor of data?.factors ?? []) {
      await admin.auth.admin.mfa.deleteFactor({ userId, id: factor.id }).catch(() => undefined);
    }
  } catch (error) {
    // Not fatal on its own — `mfa_enrolled_at` is cleared regardless, so
    // the gate still sends them through enrolment.
    logger.warn("mfa_factor_cleanup_failed", { error: String(error) });
  }
}
