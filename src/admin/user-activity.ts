import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database";

/**
 * One account's history, assembled for the staff detail view.
 *
 * ## What this is, and what it deliberately is not
 *
 * This answers "what has happened *to* this account, and who did it" —
 * the question support actually gets asked. It is built from two records
 * that already exist:
 *
 *   - `moderation_records` — the reasoned, human account of moderation
 *     (suspended, restored, a note), which carries the *why*.
 *   - `admin_audit_logs` filtered to `target_id` — every privileged action
 *     aimed at this account, which carries the *what* and the *who*.
 *
 * It is **not** a record of what the user did inside the product. No
 * conversation titles, no message content, no prompts. A moderator
 * reviewing an abuse report does not need to read someone's chats to act
 * on the account, and building the affordance is what makes the overreach
 * possible later. Sign-in history — the one piece of genuine user
 * activity staff need for "was that really me?" — is already served by
 * the device list, which shows each session's device and location.
 *
 * ## Why the two sources are merged rather than shown as two tables
 *
 * They interleave. A suspension appears in both (once with its reason,
 * once as the audited act), and read separately neither tells the story.
 * Merged and sorted, the account reads as a single timeline, which is how
 * anyone reconstructing an incident actually needs it.
 */

export type ActivitySource = "moderation" | "audit";

export interface ActivityEntry {
  id: string;
  source: ActivitySource;
  /** Machine key: a `moderation_records.action`, or an audited action. */
  action: string;
  /** Operator-supplied reason or note. Only moderation records carry one. */
  reason: string | null;
  /** Display name of whoever performed it; null means the system did. */
  actorName: string | null;
  actorId: string | null;
  /** "failure" entries are kept — a refused action is part of the history. */
  result: "success" | "failure";
  metadata: Json;
  createdAt: string;
}

/**
 * Resolves operator ids to names in one query.
 *
 * The alternative — a lookup per row — turned a 50-row history into 50
 * round trips, and most timelines are the same two or three operators
 * over and over.
 */
async function resolveActorNames(
  supabase: ReturnType<typeof createServiceRoleClient>,
  ids: Array<string | null>,
): Promise<Map<string, string>> {
  const unique = Array.from(new Set(ids.filter((id): id is string => Boolean(id))));
  if (unique.length === 0) return new Map();

  const { data } = await supabase.from("profiles").select("id, email, display_name").in("id", unique);
  return new Map((data ?? []).map((row) => [row.id, row.display_name || row.email || row.id]));
}

export async function getUserActivity(userId: string, limit = 50): Promise<ActivityEntry[]> {
  const supabase = createServiceRoleClient();

  // Each source is capped at `limit` before merging, so one noisy source
  // cannot crowd the other out of the window.
  const [moderationResult, auditResult] = await Promise.all([
    supabase
      .from("moderation_records")
      .select("id, action, reason, performed_by, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(limit),
    supabase
      .from("admin_audit_logs")
      .select("id, actor_id, action, result, metadata, created_at")
      .eq("target_id", userId)
      .eq("target_type", "user")
      .order("created_at", { ascending: false })
      .limit(limit),
  ]);

  const moderationRows = moderationResult.data ?? [];
  const auditRows = auditResult.data ?? [];

  const actorNames = await resolveActorNames(supabase, [
    ...moderationRows.map((row) => row.performed_by),
    ...auditRows.map((row) => row.actor_id),
  ]);

  const entries: ActivityEntry[] = [
    ...moderationRows.map((row) => ({
      id: `moderation:${row.id}`,
      source: "moderation" as const,
      action: row.action,
      reason: row.reason,
      actorId: row.performed_by,
      actorName: row.performed_by ? (actorNames.get(row.performed_by) ?? null) : null,
      result: "success" as const,
      metadata: null as Json,
      createdAt: row.created_at,
    })),
    ...auditRows.map((row) => ({
      id: `audit:${row.id}`,
      source: "audit" as const,
      action: row.action,
      reason: null,
      actorId: row.actor_id,
      actorName: row.actor_id ? (actorNames.get(row.actor_id) ?? null) : null,
      result: row.result,
      metadata: row.metadata,
      createdAt: row.created_at,
    })),
  ];

  entries.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return entries.slice(0, limit);
}
