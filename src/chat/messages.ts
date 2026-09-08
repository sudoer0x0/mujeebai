import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * Loads a conversation's messages for the UI, with their attachments.
 *
 * Shared by the conversation page and `/api/conversations/[id]/messages`
 * so the two can never disagree about what a message looks like.
 *
 * Two things worth knowing:
 *
 * 1. The `message_variants` embed **must** name its foreign key.
 *    `messages` and `message_variants` reference each other in both
 *    directions, so a bare `message_variants(...)` is ambiguous and
 *    PostgREST rejects the entire query with PGRST201.
 *
 * 2. Attachments are fetched in a second query rather than a nested
 *    embed. `message_attachments` is a join table, and going through it
 *    to `attachments` produced a shape that had to be unwrapped twice at
 *    every call site; one extra round trip per conversation load is the
 *    better trade.
 */

export interface LoadedAttachment {
  id: string;
  filename: string;
  kind: string;
}

export interface LoadedMessage {
  id: string;
  role: "user" | "assistant" | "system";
  status: string;
  content: string | null;
  active_variant_id: string | null;
  message_variants: Array<{
    id: string;
    sequence: number;
    content: string | null;
    reasoning_summary: string | null;
    finish_reason: string | null;
    error: { code: string; message: string } | null;
    usage?: Record<string, unknown> | null;
  }>;
  attachments: LoadedAttachment[];
}

export async function loadConversationMessages(conversationId: string): Promise<LoadedMessage[]> {
  const supabase = await createServerSupabaseClient();

  const { data: messages, error } = await supabase
    .from("messages")
    .select(
      "id, role, status, content, created_at, active_variant_id, " +
        "message_variants!message_variants_message_id_fkey(id, sequence, content, reasoning_summary, finish_reason, error, usage)",
    )
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  // Never swallow this. Returning [] on a failed read is indistinguishable
  // from a genuinely empty conversation, which is precisely how the
  // PGRST201 bug above stayed invisible for so long.
  if (error) {
    logger.error("conversation_messages_load_failed", {
      conversationId,
      reason: error.message,
      code: error.code,
    });
    throw new Error("Could not load this conversation.");
  }

  const rows = (messages ?? []) as unknown as Array<Omit<LoadedMessage, "attachments"> & { created_at: string }>;
  if (rows.length === 0) return [];

  // A reply that stopped mid-flight must not read as one still arriving.
  //
  // An assistant row is created as `streaming` and settled when the turn
  // finishes. If the turn never finishes — the process is replaced, the
  // connection dies, the tab is closed before the abort lands — the row
  // stays `streaming` for good, and every later visit renders a
  // "Generating…" that will never resolve. There were 21 such rows in
  // this database.
  //
  // The route caps a turn at `maxDuration` (120s), so anything older than
  // that provably is not still running: nothing is waiting on it, and
  // saying otherwise is simply wrong. A younger one is left alone — it may
  // genuinely be streaming into another tab right now.
  const STALE_AFTER_MS = 150_000;
  const now = Date.now();
  for (const row of rows) {
    if (row.status !== "streaming") continue;
    if (now - new Date(row.created_at).getTime() < STALE_AFTER_MS) continue;
    // Whatever arrived is kept; only the claim that more is coming is
    // dropped. With no text at all it was a failure, not an interruption.
    row.status = (row.content ?? "").trim() ? "stopped" : "error";
  }

  const { data: links, error: linkError } = await supabase
    .from("message_attachments")
    .select("message_id, attachments(id, original_filename, kind)")
    .in(
      "message_id",
      rows.map((row) => row.id),
    );

  // An attachment lookup failure degrades to "message without its files"
  // rather than losing the conversation — the text is the important part.
  if (linkError) {
    logger.warn("message_attachments_load_failed", { conversationId, reason: linkError.message });
  }

  const byMessage = new Map<string, LoadedAttachment[]>();
  for (const link of links ?? []) {
    const attachment = link.attachments as unknown as
      | { id: string; original_filename: string; kind: string }
      | null;
    if (!attachment) continue;

    const list = byMessage.get(link.message_id) ?? [];
    list.push({ id: attachment.id, filename: attachment.original_filename, kind: attachment.kind });
    byMessage.set(link.message_id, list);
  }

  return rows.map((row) => ({ ...row, attachments: byMessage.get(row.id) ?? [] }));
}
