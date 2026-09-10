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

  // Reconcile and settle any assistant rows that were left in an unsettled or anomalous state.
  // In a loaded conversation (page load / reload), any message with valid content in either
  // the message row or its variants is completed, ensuring AI outputs never disappear or
  // get replaced by error alerts on reload.
  const toHealInDb: Array<{ id: string; content: string; status: "complete" | "stopped" | "error" }> = [];
  const now = Date.now();

  for (const row of rows) {
    if (row.role !== "assistant") continue;

    const variants = row.message_variants ?? [];
    const activeVariant =
      variants.find((v) => v.id === row.active_variant_id) ??
      variants[variants.length - 1];

    const variantContent = (activeVariant?.content ?? "").trim();
    const rowContent = (row.content ?? "").trim();
    const effectiveContent = variantContent || rowContent;

    // If message row content is empty but variant has content, backfill row.content
    if (!row.content && effectiveContent) {
      row.content = effectiveContent;
    }

    if (effectiveContent) {
      // If the message has text, it must NEVER be rendered as an error or left
      // in streaming state on reload.
      if (row.status === "streaming" || row.status === "pending" || row.status === "error") {
        const settledStatus = activeVariant?.finish_reason === "stopped" ? "stopped" : "complete";
        row.status = settledStatus;
        toHealInDb.push({ id: row.id, content: effectiveContent, status: settledStatus });
      }
    } else {
      // No text arrived at all
      if (row.status === "streaming") {
        const ageMs = now - new Date(row.created_at).getTime();
        // A turn older than 20s with zero text was a failure, not an in-flight reply.
        if (ageMs > 20_000) {
          row.status = "error";
          toHealInDb.push({ id: row.id, content: "", status: "error" });
        }
      }
    }
  }

  // Self-heal rows in the database in the background so future queries don't see stale rows
  if (toHealInDb.length > 0) {
    void (async () => {
      try {
        const { createServiceRoleClient } = await import("@/lib/supabase/server");
        const adminClient = createServiceRoleClient();
        for (const item of toHealInDb) {
          await adminClient
            .from("messages")
            .update({ content: item.content, status: item.status })
            .eq("id", item.id);
        }
      } catch {
        // Non-blocking
      }
    })();
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
