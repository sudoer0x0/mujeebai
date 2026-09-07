import { NextResponse } from "next/server";
import { z } from "zod";
import { requireActiveProfile } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getDefaultModel, getModelBySlug } from "@/ai/registry";
import { checkModelAccess } from "@/ai/access";
import { consumeQuota } from "@/usage/quota";
import { loadConversationHistory } from "@/ai/conversation";
import { runAssistantTurn } from "@/ai/run-turn";
import { checkRateLimit } from "@/lib/rate-limit";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  messageId: z.string().uuid(),
  content: z.string().min(1).max(20_000),
  modelSlug: z.string().max(64).optional(),
});

/**
 * Edits a user message and regenerates the answer that followed it.
 *
 * The chat UI's "edit" control used to call the same handler as "send",
 * which appended the edited text as a *new* message at the bottom of the
 * conversation and left the original — and its now-orphaned answer —
 * untouched. That is not an edit; it is a confusing duplicate.
 *
 * What this does instead:
 *   1. verify the message belongs to the caller and is theirs to edit,
 *   2. rewrite its content and stamp `edited_at`,
 *   3. delete everything that came *after* it (the answers that were
 *      responding to the old text and no longer make sense),
 *   4. re-run the turn from the edited history.
 *
 * Step 3 is a deliberate trade-off: the data model leaves room for
 * branching (#22/#23), but branch *navigation* has no UI yet, and keeping
 * unreachable messages around would show up as gaps in the transcript.
 */
export async function POST(request: Request) {
  let profile;
  try {
    profile = await requireActiveProfile();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`chat:${profile.id}`, 20, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createServerSupabaseClient();

  // RLS restricts this to the caller's own rows; the explicit user_id and
  // role filters make the intent legible and keep an assistant message
  // from being passed off as an editable user message.
  const { data: message } = await supabase
    .from("messages")
    .select("id, conversation_id, created_at, user_id, role")
    .eq("id", parsed.data.messageId)
    .eq("user_id", profile.id)
    .eq("role", "user")
    .maybeSingle();

  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  const { error: updateError } = await supabase
    .from("messages")
    .update({ content: parsed.data.content, edited_at: new Date().toISOString() })
    .eq("id", message.id);

  if (updateError) {
    logger.error("message_edit_failed", { reason: updateError.message });
    return NextResponse.json({ error: "errors.serverError.title" }, { status: 500 });
  }

  // Drop the superseded tail. Variants and attachments cascade.
  await supabase
    .from("messages")
    .delete()
    .eq("conversation_id", message.conversation_id)
    .gt("created_at", message.created_at);

  const model = parsed.data.modelSlug ? await getModelBySlug(parsed.data.modelSlug) : await getDefaultModel();
  if (!model) return NextResponse.json({ error: "No model available" }, { status: 503 });

  const accessDenied = await checkModelAccess(profile.id, model);
  if (accessDenied) return NextResponse.json({ error: accessDenied.errorKey }, { status: accessDenied.status });

  const history = await loadConversationHistory(message.conversation_id);

  const { data: assistantMessage, error: assistantError } = await supabase
    .from("messages")
    .insert({
      conversation_id: message.conversation_id,
      user_id: profile.id,
      role: "assistant",
      status: "streaming",
    })
    .select()
    .single();

  if (assistantError || !assistantMessage) {
    return NextResponse.json({ error: "errors.serverError.title" }, { status: 500 });
  }

  const { data: variant } = await supabase
    .from("message_variants")
    .insert({ message_id: assistantMessage.id, sequence: 1, model_id: model.id })
    .select()
    .single();

  if (variant) {
    await supabase.from("messages").update({ active_variant_id: variant.id }).eq("id", assistantMessage.id);
  }

  try {
    await consumeQuota(profile.id, "messages");
  } catch {
    await supabase.from("messages").update({ status: "error" }).eq("id", assistantMessage.id);
    return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });
  }

  return runAssistantTurn({
    model,
    conversationHistory: history,
    conversationId: message.conversation_id,
    assistantMessageId: assistantMessage.id,
    variantId: variant?.id ?? "",
    userId: profile.id,
    signal: request.signal,
  });
}
