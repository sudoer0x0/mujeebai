import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { GatewayError, type ChatContentPart, type ChatMessageInput } from "@/ai/types";
import type { Tables } from "@/types/database";

export type MessageRow = Tables<"messages">;
export type MessageVariantRow = Tables<"message_variants">;
export type AttachmentRow = Tables<"attachments">;

// Derives conversation title from first user prompt.
export function deriveTitle(content: string): string {
  const trimmed = content.trim().replace(/\s+/g, " ");
  if (!trimmed) return "New conversation";
  return trimmed.length > 60 ? `${trimmed.slice(0, 57)}…` : trimmed;
}

// Loads prior conversation history formatted for model gateway.
export async function loadConversationHistory(conversationId: string): Promise<ChatMessageInput[]> {
  const supabase = await createServerSupabaseClient();

  const { data: messages, error } = await supabase
    .from("messages")
    .select("id, role, content, active_variant_id")
    .eq("conversation_id", conversationId)
    .order("created_at", { ascending: true });

  if (error) throw new GatewayError("unknown", `Failed to load conversation: ${error.message}`);

  // Fetch every active variant in one query rather than one per assistant
  // message. This runs on the hot path of every chat turn, so an N+1 here
  // adds a round trip per prior reply — a twenty-message conversation paid
  // for ten extra queries before the model was even called.
  const variantIds = (messages ?? [])
    .filter((message) => message.role === "assistant" && message.active_variant_id)
    .map((message) => message.active_variant_id as string);

  const variantContent = new Map<string, string>();
  if (variantIds.length > 0) {
    const { data: variants, error: variantError } = await supabase
      .from("message_variants")
      .select("id, content")
      .in("id", variantIds);

    if (variantError) {
      throw new GatewayError("unknown", `Failed to load conversation: ${variantError.message}`);
    }
    for (const variant of variants ?? []) {
      if (variant.content) variantContent.set(variant.id, variant.content);
    }
  }

  const history: ChatMessageInput[] = [];
  for (const message of messages ?? []) {
    if (message.role === "assistant") {
      const content = message.active_variant_id ? variantContent.get(message.active_variant_id) : undefined;
      if (content) history.push({ role: "assistant", content });
      continue;
    }

    if (!message.content) continue;
    history.push({ role: message.role as "user" | "system", content: message.content });
  }

  return history;
}

/** Attaches image content parts (as data URLs) for vision-capable requests. */
export async function buildUserContentWithAttachments(
  text: string,
  attachments: AttachmentRow[],
): Promise<ChatMessageInput["content"]> {
  const images = attachments.filter((a) => a.kind === "image");
  if (images.length === 0) return text;

  const { createStorageAdapter } = await import("@/storage/factory");
  const storage = createStorageAdapter();

  const parts: ChatContentPart[] = [{ type: "text", text }];

  for (const image of images) {
    const url = await storage.getUrl(image.storage_path, { expiresInSeconds: 3600 });
    parts.push({ type: "image_url", imageUrl: url });
  }

  return parts;
}
