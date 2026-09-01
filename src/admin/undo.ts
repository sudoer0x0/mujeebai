import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { AdminAction } from "@/admin/permissions";
import type { Json } from "@/types/database";

/**
 * What can be undone, and what undoing it means.
 *
 * ## The rule
 *
 * An action is undoable when the audit entry recorded enough to restore
 * the prior state exactly. That is why several actions grew a `from` field
 * in their metadata: "suspended this account" is not reversible on its
 * own, because the account might have been `pending_verification` rather
 * than `active` before.
 *
 * Anything whose effect left the system — an email that was sent, a
 * session that was revoked, an account that was deleted from the auth
 * provider — is **not** undoable, and is not listed here. Offering an
 * "undo" that silently does nothing is worse than offering none.
 *
 * ## Authorization
 *
 * Undo is not its own privilege. Reverting an action requires the
 * permission that performing it would require *now* — so a moderator can
 * undo a suspension (they may suspend) but not a price change (they may
 * not), regardless of who performed the original. This is checked in the
 * server action, against the live profile, before anything is written.
 *
 * ## Why undo is a new audit row, never an edit
 *
 * `admin_audit_logs` is append-only, enforced by a database trigger
 * (migration 0008). An undo therefore records a *new* entry that points at
 * the original via `metadata.undoes`, and "has this been undone?" is
 * answered by looking for such an entry. The trail stays a trail: it shows
 * that something was done and then reversed, rather than pretending it
 * never happened.
 */

export interface UndoableSpec {
  /** Permission the actor must hold *now* to reverse this. */
  permission: AdminAction;
  /** Message key describing what undoing does, shown in the confirmation. */
  labelKey: string;
}

export const UNDOABLE: Record<string, UndoableSpec> = {
  "admin.user_suspended": { permission: "users.restore", labelKey: "undo.userStatus" },
  "admin.user_disabled": { permission: "users.restore", labelKey: "undo.userStatus" },
  "admin.user_restored": { permission: "users.suspend", labelKey: "undo.userStatus" },
  "admin.moderator_created": { permission: "moderators.remove", labelKey: "undo.role" },
  "admin.moderator_removed": { permission: "moderators.create", labelKey: "undo.role" },
  "admin.plan_updated": { permission: "plans.manage", labelKey: "undo.planPrice" },
  "admin.plan_currency_prices_updated": { permission: "plans.manage", labelKey: "undo.planPrices" },
  "admin.feature_flag_changed": { permission: "feature_flags.manage", labelKey: "undo.featureFlag" },
  "admin.system_setting_changed": { permission: "system_settings.manage", labelKey: "undo.setting" },
  "admin.quota_changed": { permission: "usage.override", labelKey: "undo.quota" },
  // Undoing an invite deletes the account it created. `users.delete` is
  // super-admin-only, which is the intended asymmetry: a moderator may
  // issue an invitation, and reversing one is an administrator's call.
  "admin.user_invited": { permission: "users.delete", labelKey: "undo.invite" },
};


export interface AuditEntry {
  id: string;
  action: string;
  target_id: string | null;
  target_type: string | null;
  result: string;
  metadata: Json;
  created_at: string;
}

type Meta = Record<string, Json | undefined>;

const USER_STATUSES = ["active", "suspended", "disabled", "pending_verification", "deleted"] as const;
type UserStatus = (typeof USER_STATUSES)[number];

/**
 * Validates a status read back out of audit metadata.
 *
 * The metadata column is `jsonb`, so what comes out is whatever went in —
 * possibly from an older build with a different vocabulary. Undo refuses
 * a value it does not recognise rather than writing it into `profiles`
 * and relying on a check constraint to catch it.
 */
function isUserStatus(value: string): value is UserStatus {
  return (USER_STATUSES as readonly string[]).includes(value);
}

function isRole(value: string): value is "user" | "moderator" | "super_admin" {
  return value === "user" || value === "moderator" || value === "super_admin";
}

/**
 * Applies the reversal. Returns a human-free result the caller audits.
 *
 * Every branch restores a value that was captured at the time — none of
 * them recompute what the prior state "should" have been.
 */
export async function applyUndo(entry: AuditEntry): Promise<{ ok: boolean; reason?: string }> {
  const supabase = createServiceRoleClient();
  const meta = (entry.metadata ?? {}) as Meta;
  const targetId = entry.target_id;

  switch (entry.action) {
    case "admin.user_suspended":
    case "admin.user_disabled":
    case "admin.user_restored": {
      const previous = meta.from;
      if (!targetId || typeof previous !== "string" || !isUserStatus(previous)) {
        return { ok: false, reason: "no_prior_state" };
      }
      const { error } = await supabase.from("profiles").update({ status: previous }).eq("id", targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    case "admin.moderator_created":
    case "admin.moderator_removed": {
      // Both are role changes; `previousRole` is recorded by the role
      // action, and the console's own moderator flow records neither
      // (it creates a fresh account), so that case is handled by role.
      const previous = meta.previousRole;
      if (!targetId || typeof previous !== "string" || !isRole(previous)) {
        return { ok: false, reason: "no_prior_state" };
      }
      const { error } = await supabase.from("profiles").update({ role: previous }).eq("id", targetId);
      if (error) return { ok: false, reason: error.message };
      // Demotion must also end live sessions, exactly as the forward
      // action does — otherwise "undo" leaves a working staff token.
      if (previous === "user") {
        await supabase.auth.admin.signOut(targetId, "global").catch(() => undefined);
      }
      return { ok: true };
    }

    case "admin.plan_updated": {
      const previous = meta.from;
      if (!targetId || previous === null || previous === undefined) return { ok: false, reason: "no_prior_state" };
      const { error } = await supabase
        .from("plans")
        .update({ price_usd: Number(previous) })
        .eq("id", targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    case "admin.plan_currency_prices_updated": {
      const previous = meta.from;
      if (!targetId || previous === undefined) return { ok: false, reason: "no_prior_state" };
      const { error } = await supabase
        .from("plans")
        .update({ currency_prices: (previous ?? {}) as Json })
        .eq("id", targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    case "admin.feature_flag_changed": {
      const previous = meta.from;
      if (!targetId || typeof previous !== "boolean") return { ok: false, reason: "no_prior_state" };
      const { error } = await supabase.from("feature_flags").update({ enabled: previous }).eq("id", targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    case "admin.system_setting_changed": {
      const previous = meta.from;
      if (!targetId || previous === undefined) return { ok: false, reason: "no_prior_state" };
      const { error } = await supabase
        .from("system_settings")
        .update({ value: previous as Json, updated_at: new Date().toISOString() })
        .eq("key", targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    case "admin.quota_changed": {
      const featureKey = meta.featureKey;
      if (!targetId || typeof featureKey !== "string") return { ok: false, reason: "no_prior_state" };

      // `removed: true` means the forward action deleted an override, and
      // undo cannot restore it — the value it held was not recorded.
      if (meta.removed === true) return { ok: false, reason: "no_prior_state" };

      const previous = meta.from;
      if (previous === null || previous === undefined) {
        // There was no override before; undo means removing the one added.
        const { error } = await supabase
          .from("user_entitlements")
          .delete()
          .eq("user_id", targetId)
          .eq("feature_key", featureKey);
        return error ? { ok: false, reason: error.message } : { ok: true };
      }

      const { error } = await supabase
        .from("user_entitlements")
        .update({ value: previous as Json })
        .eq("user_id", targetId)
        .eq("feature_key", featureKey);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }


    case "admin.user_invited": {
      if (!targetId) return { ok: false, reason: "no_prior_state" };

      // Only reversible while it is still just an invitation. Once
      // somebody has redeemed it the account is theirs, and "undo" must
      // not become a way to delete a real customer weeks later because a
      // stale button was still on screen.
      const { data: account } = await supabase.auth.admin.getUserById(targetId);
      if (!account?.user) return { ok: false, reason: "already_gone" };
      if (account.user.last_sign_in_at) return { ok: false, reason: "invite_redeemed" };

      const { count } = await supabase
        .from("conversations")
        .select("id", { count: "exact", head: true })
        .eq("user_id", targetId);
      if ((count ?? 0) > 0) return { ok: false, reason: "invite_redeemed" };

      const { error } = await supabase.auth.admin.deleteUser(targetId);
      return error ? { ok: false, reason: error.message } : { ok: true };
    }

    default:
      return { ok: false, reason: "not_undoable" };
  }
}
