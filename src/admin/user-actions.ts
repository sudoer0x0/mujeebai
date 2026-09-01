"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertCanActOn, assertPermission, type Role } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { getUserForAction } from "@/admin/users";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { sendAuthLink } from "@/auth/registration";
import { resetUsageForUser, setUserOverride, removeUserOverride } from "@/usage/admin";
import { isOverridableFeatureKey, isUsageCategory, type UsageCategory } from "@/usage/categories";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

/**
 * Account actions shared by both staff portals.
 *
 * Every one of these follows the same shape, and it is not negotiable:
 *
 *   1. `requireStaff()`   — load the actor's profile *from the database*,
 *                           never from anything the browser sent.
 *   2. `assertCanActOn()` — check the action against the role matrix AND
 *                           against who the target is.
 *   3. do the work through the service role.
 *   4. `recordAuditEvent()` — including on failure.
 *
 * Server Actions are POST endpoints with a stable id, reachable by anyone
 * who can read the page bundle. Rendering a menu item conditionally is a
 * UI nicety; step 2 is the actual security boundary.
 */

export interface ActionResponse {
  ok: boolean;
  /** Message-catalog key. */
  message?: string;
  /** Free-form detail for messages that interpolate a count. */
  count?: number;
}

const uuid = z.string().uuid();

function failure(error: unknown): ActionResponse {
  if (error instanceof ForbiddenError) {
    return { ok: false, message: "admin.common.notPermitted" };
  }
  logger.error("staff_action_failed", { error: String(error) });
  return { ok: false, message: "admin.common.actionFailed" };
}

async function moderate(
  userId: string,
  status: "active" | "suspended" | "disabled",
  reason: string | null,
): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    const targetId = uuid.parse(userId);
    const target = await getUserForAction(targetId);
    if (!target) return { ok: false, message: "admin.users.detail.notFound" };

    const action =
      status === "active" ? "users.restore" : status === "suspended" ? "users.suspend" : "users.disable";
    assertCanActOn(actor, target, action);

    const supabase = createServiceRoleClient();
    const { error } = await supabase.from("profiles").update({ status }).eq("id", targetId);

    if (!error) {
      await supabase.from("moderation_records").insert({
        user_id: targetId,
        action: status === "active" ? "restored" : status === "suspended" ? "suspended" : "disabled",
        reason,
        performed_by: actor.id,
      });
    }

    await recordAuditEvent({
      actorId: actor.id,
      action: `admin.user_${status === "active" ? "restored" : status}`,
      targetType: "user",
      targetId,
      result: error ? "failure" : "success",
      // `from` is what makes this undoable. Recording only the new status
      // would leave an operator who suspended the wrong account with no
      // record of what to put back.
      metadata: { reason, from: target.status, to: status },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    revalidatePath("/admin/users");
    revalidatePath("/moderator/users");
    revalidatePath("/admin/moderation");
    revalidatePath("/moderator/moderation");
    return { ok: true, message: "admin.common.save" };
  } catch (error) {
    return failure(error);
  }
}

export async function suspendUserAction(userId: string, reason: string): Promise<ActionResponse> {
  if (!reason.trim()) return { ok: false, message: "moderator.reason.required" };
  return moderate(userId, "suspended", reason.trim().slice(0, 500));
}

export async function restoreUserAction(userId: string, reason = ""): Promise<ActionResponse> {
  return moderate(userId, "active", reason.trim().slice(0, 500) || null);
}

export async function disableUserAction(userId: string, reason: string): Promise<ActionResponse> {
  if (!reason.trim()) return { ok: false, message: "moderator.reason.required" };
  return moderate(userId, "disabled", reason.trim().slice(0, 500));
}

export async function addModerationNoteAction(userId: string, note: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "moderation.note");
    const targetId = uuid.parse(userId);
    const trimmed = note.trim().slice(0, 1000);
    if (!trimmed) return { ok: false, message: "moderator.reason.required" };

    const supabase = createServiceRoleClient();
    await supabase.from("moderation_records").insert({
      user_id: targetId,
      action: "note",
      reason: trimmed,
      performed_by: actor.id,
    });

    revalidatePath("/moderator/moderation");
    revalidatePath("/admin/moderation");
    return { ok: true, message: "moderator.note.saved" };
  } catch (error) {
    return failure(error);
  }
}

export async function deleteUserAction(userId: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    const targetId = uuid.parse(userId);
    const target = await getUserForAction(targetId);
    if (!target) return { ok: false, message: "admin.users.detail.notFound" };

    assertCanActOn(actor, target, "users.delete");

    const supabase = createServiceRoleClient();
    const { error } = await supabase.auth.admin.deleteUser(targetId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.user_deleted",
      targetType: "user",
      targetId,
      result: error ? "failure" : "success",
      // The email is the only way to identify the account after the row
      // is gone, and an audit trail of anonymous uuids is not much of one.
      metadata: { email: target.email },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    revalidatePath("/admin/users");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

/**
 * Sends a recovery, sign-in or verification link — and actually sends it.
 *
 * The previous implementation called `auth.admin.generateLink()` and then
 * dropped the result on the floor, so the console reported "Reset link
 * sent" while nothing was ever delivered. These route through the same
 * mailer as the public auth flows.
 */
async function sendLink(
  userId: string,
  kind: "reset" | "magicLink" | "verify",
  action: "users.reset_password" | "users.send_magic_link" | "users.send_verification",
): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    const targetId = uuid.parse(userId);
    const target = await getUserForAction(targetId);
    if (!target?.email) return { ok: false, message: "admin.users.detail.notFound" };

    assertCanActOn(actor, target, action);

    const supabase = createServiceRoleClient();
    const { data: profile } = await supabase.from("profiles").select("locale").eq("id", targetId).maybeSingle();

    const { delivered } = await sendAuthLink({
      kind,
      email: target.email,
      locale: profile?.locale ?? "en",
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: `admin.${kind === "reset" ? "password_reset" : kind === "magicLink" ? "magic_link_created" : "verification_resent"}`,
      targetType: "user",
      targetId,
      result: delivered ? "success" : "failure",
    });

    // Report honestly. "Sent" when no mail provider is configured is the
    // exact failure mode this replaces.
    return delivered
      ? { ok: true, message: "auth.verify.resendSuccess" }
      : { ok: false, message: "auth.errors.emailDeliveryFailed" };
  } catch (error) {
    return failure(error);
  }
}

export async function sendPasswordResetAction(userId: string) {
  return sendLink(userId, "reset", "users.reset_password");
}

export async function sendMagicLinkAction(userId: string) {
  return sendLink(userId, "magicLink", "users.send_magic_link");
}

export async function sendVerificationAction(userId: string) {
  return sendLink(userId, "verify", "users.send_verification");
}

/**
 * Ends every live session for an account.
 *
 * The support answer to "I think someone else is signed in as me", and
 * the thing to do the moment an account looks compromised. Both staff
 * roles hold it because it is the rare privileged action with no
 * destructive edge: no data is touched, and the account holder simply
 * signs in again.
 *
 * Not undoable, and deliberately absent from UNDOABLE rather than listed
 * with a no-op — a revoked token cannot be un-revoked, and an "undo" that
 * quietly does nothing is worse than none.
 */
export async function revokeUserSessionsAction(userId: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    const targetId = uuid.parse(userId);
    const target = await getUserForAction(targetId);
    if (!target) return { ok: false, message: "admin.users.detail.notFound" };

    assertCanActOn(actor, target, "users.revoke_sessions");

    const supabase = createServiceRoleClient();
    const { error } = await supabase.auth.admin.signOut(targetId, "global");

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.sessions_revoked",
      targetType: "user",
      targetId,
      result: error ? "failure" : "success",
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    revalidatePath("/admin/users");
    revalidatePath("/moderator/users");
    return { ok: true, message: "admin.users.sessionsRevoked" };
  } catch (error) {
    return failure(error);
  }
}

export async function modifyUserRoleAction(userId: string, role: Role): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    const targetId = uuid.parse(userId);
    const target = await getUserForAction(targetId);
    if (!target) return { ok: false, message: "admin.users.detail.notFound" };

    assertCanActOn(actor, target, "users.modify_role");
    if (role === "moderator") assertPermission(actor, "moderators.create");
    if (role === "user") assertPermission(actor, "moderators.remove");
    if (role === "super_admin") {
      // Minting a super admin from the web console is deliberately not
      // possible — it is the one role that can disable every other
      // control, so it only comes from the bootstrap script (#29).
      throw new ForbiddenError("Super Admins can only be granted through scripts/super-admin.ts");
    }

    const supabase = createServiceRoleClient();

    if (role === "user") {
      const { error } = await supabase
        .from("admin_roles")
        .update({ revoked_at: new Date().toISOString(), revoked_by: actor.id })
        .eq("user_id", targetId)
        .is("revoked_at", null);
      if (error) throw error;
    } else {
      const { error } = await supabase
        .from("admin_roles")
        .insert({ user_id: targetId, role, granted_by: actor.id });
      if (error) throw error;
    }

    await recordAuditEvent({
      actorId: actor.id,
      action: role === "user" ? "admin.moderator_removed" : "admin.moderator_created",
      targetType: "user",
      targetId,
      metadata: { newRole: role, previousRole: target.role },
    });

    revalidatePath("/admin/users");
    return { ok: true };
  } catch (error) {
    return failure(error);
  }
}

export async function resetUserUsageAction(userId: string, category?: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "usage.reset_user");
    const targetId = uuid.parse(userId);

    const scoped: UsageCategory | undefined =
      category && isUsageCategory(category) ? category : undefined;
    const count = await resetUsageForUser(targetId, scoped);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.quota_reset",
      targetType: "user",
      targetId,
      metadata: { category: scoped ?? "all", countersReset: count },
    });

    revalidatePath("/admin/usage");
    revalidatePath(`/admin/users/${targetId}`);
    return { ok: true, message: "admin.usage.resetUserDone", count };
  } catch (error) {
    return failure(error);
  }
}

const overrideSchema = z.object({
  userId: z.string().uuid(),
  featureKey: z.string().min(1).max(64),
  value: z.union([z.number().int().min(-1).max(1_000_000), z.boolean()]),
  reason: z.string().max(500).optional(),
  expiresAt: z.string().datetime().nullable().optional(),
});

/**
 * The current per-user override for a feature, or null if there is none.
 *
 * "No override" and "an override set to zero" are different states, and
 * undo has to be able to tell them apart — restoring a zero where there
 * was previously nothing would silently cap an account at zero.
 */
async function readOverrideValue(userId: string, featureKey: string): Promise<Json | null> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("user_entitlements")
    .select("value")
    .eq("user_id", userId)
    .eq("feature_key", featureKey)
    .maybeSingle();
  return data?.value ?? null;
}

export async function setUserOverrideAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();

    const parsed = overrideSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.common.actionFailed" };

    // The attachment limit is the one quota a moderator may adjust; every
    // other one stays super-admin-only. Checked against the parsed key,
    // never against anything the client asserts about itself.
    assertPermission(
      actor,
      parsed.data.featureKey === "max_attachments_per_message"
        ? "usage.override_attachments"
        : "usage.override",
    );

    // Only known feature keys may be overridden. Without this an operator
    // typo writes a row nothing ever reads, and the account silently keeps
    // its old limit while the console shows an override that does nothing.
    if (!isOverridableFeatureKey(parsed.data.featureKey)) {
      return { ok: false, message: "admin.common.actionFailed" };
    }

    // Read what is there now, before overwriting it, so the change can be
    // undone back to the exact prior value rather than to a guess.
    const previousOverride = await readOverrideValue(parsed.data.userId, parsed.data.featureKey);

    await setUserOverride({
      userId: parsed.data.userId,
      featureKey: parsed.data.featureKey,
      value: parsed.data.value,
      reason: parsed.data.reason,
      expiresAt: parsed.data.expiresAt ?? null,
      grantedBy: actor.id,
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.quota_changed",
      targetType: "user",
      targetId: parsed.data.userId,
      metadata: {
        featureKey: parsed.data.featureKey,
        value: parsed.data.value,
        reason: parsed.data.reason ?? null,
        // null here means "there was no override" — undo removes it
        // rather than restoring a value that never existed.
        from: previousOverride,
      },
    });

    revalidatePath(`/admin/users/${parsed.data.userId}`);
    return { ok: true, message: "admin.usage.overrideSaved" };
  } catch (error) {
    return failure(error);
  }
}

export async function removeUserOverrideAction(userId: string, featureKey: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "usage.override");
    const targetId = uuid.parse(userId);

    await removeUserOverride(targetId, featureKey);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.quota_changed",
      targetType: "user",
      targetId,
      metadata: { featureKey, removed: true },
    });

    revalidatePath(`/admin/users/${targetId}`);
    return { ok: true, message: "admin.usage.overrideRemoved" };
  } catch (error) {
    return failure(error);
  }
}
