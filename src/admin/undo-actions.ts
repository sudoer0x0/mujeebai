"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { applyUndo, UNDOABLE, type AuditEntry } from "@/admin/undo";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

const schema = z.object({ auditId: z.string().uuid() });

/**
 * Reverses a previously recorded administrative action.
 *
 * Available to super admins and moderators alike — but only for actions
 * each is allowed to perform. `assertPermission` runs against the *live*
 * profile of whoever is clicking, against the permission the forward
 * action requires, so a moderator can undo a suspension and not a price
 * change. Who performed the original is irrelevant to whether you may
 * reverse it.
 */
export async function undoAuditActionAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.undo.failed" };

    const supabase = createServiceRoleClient();
    const { data: entry } = await supabase
      .from("admin_audit_logs")
      .select("id, action, target_id, target_type, result, metadata, created_at")
      .eq("id", parsed.data.auditId)
      .maybeSingle();

    if (!entry) return { ok: false, message: "admin.undo.notFound" };

    // A failed action changed nothing, so there is nothing to reverse.
    if (entry.result !== "success") return { ok: false, message: "admin.undo.notUndoable" };

    const spec = UNDOABLE[entry.action];
    if (!spec) return { ok: false, message: "admin.undo.notUndoable" };

    assertPermission(actor, spec.permission);

    // Undo once. Without this an operator could click twice and, for a
    // toggle, land back where they started while the trail claims two
    // reversals.
    if (await alreadyUndone(entry.id)) {
      return { ok: false, message: "admin.undo.alreadyUndone" };
    }

    const result = await applyUndo(entry as AuditEntry);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.action_undone",
      targetType: entry.target_type ?? undefined,
      targetId: entry.target_id ?? undefined,
      result: result.ok ? "success" : "failure",
      // `undoes` is how the trail links the two, and how the check above
      // knows this entry has been reversed.
      metadata: { undoes: entry.id, undoneAction: entry.action, reason: result.reason ?? null },
    });

    if (!result.ok) {
      logger.warn("undo_failed", { auditId: entry.id, action: entry.action, reason: result.reason });
      // Say *why* it could not be reversed. "Undo failed" on an invite
      // the recipient has already used sends the operator looking for a
      // bug; "they have already signed in" tells them the account is now
      // a real one and deleting it is a separate, deliberate decision.
      const reasonKey =
        result.reason === "no_prior_state"
          ? "admin.undo.noPriorState"
          : result.reason === "invite_redeemed"
            ? "admin.undo.inviteRedeemed"
            : result.reason === "already_gone"
              ? "admin.undo.alreadyGone"
              : "admin.undo.failed";
      return { ok: false, message: reasonKey };
    }

    // The reverted value can appear on any of these, and which one depends
    // on the action, so refresh the console broadly rather than guessing.
    revalidatePath("/", "layout");
    return { ok: true, message: "admin.undo.done" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("undo_unexpected", { error: String(error) });
    return { ok: false, message: "admin.undo.failed" };
  }
}

/** True when some later entry already reverses this one. */
async function alreadyUndone(auditId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("admin_audit_logs")
    .select("id")
    .eq("action", "admin.action_undone")
    .eq("result", "success")
    .contains("metadata", { undoes: auditId })
    .limit(1);
  return (data?.length ?? 0) > 0;
}

/**
 * Marks which of a page's audit entries can currently be reversed.
 *
 * Done as one query for the whole page rather than one per row: the audit
 * log renders fifty entries, and a per-row existence check would be fifty
 * round trips to render a table.
 */
export async function getUndoState(
  entries: Array<{ id: string; action: string; result: string }>,
): Promise<Record<string, "undoable" | "undone" | "no">> {
  const candidates = entries.filter((entry) => entry.result === "success" && entry.action in UNDOABLE);
  if (candidates.length === 0) {
    return Object.fromEntries(entries.map((entry) => [entry.id, "no" as const]));
  }

  const supabase = createServiceRoleClient();
  const { data: undos } = await supabase
    .from("admin_audit_logs")
    .select("metadata")
    .eq("action", "admin.action_undone")
    .eq("result", "success")
    .limit(1000);

  const undoneIds = new Set(
    (undos ?? [])
      .map((row) => (row.metadata as { undoes?: string } | null)?.undoes)
      .filter((value): value is string => typeof value === "string"),
  );

  const state: Record<string, "undoable" | "undone" | "no"> = {};
  for (const entry of entries) {
    if (!(entry.action in UNDOABLE) || entry.result !== "success") state[entry.id] = "no";
    else state[entry.id] = undoneIds.has(entry.id) ? "undone" : "undoable";
  }
  return state;
}
