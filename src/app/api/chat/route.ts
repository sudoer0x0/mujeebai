import { NextResponse } from "next/server";
import { getEffectiveNumber } from "@/billing/entitlements";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getDefaultModel, getDefaultVisionModel, getModelBySlug } from "@/ai/registry";
import { checkModelAccess } from "@/ai/access";
import { checkQuota, consumeQuota } from "@/usage/quota";
import { runAssistantTurn } from "@/ai/run-turn";
import { buildUserContentWithAttachments, loadConversationHistory, type AttachmentRow } from "@/ai/conversation";
import type { ChatMessageInput } from "@/ai/types";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  conversationId: z.string().uuid().optional(),
  content: z.string().min(1).max(20_000),
  modelSlug: z.string().optional(),
  attachmentIds: z.array(z.string().uuid()).max(20).optional(),
});

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return jsonError("Unauthorized", 401);
  }

  // Rate limit check.
  const rateLimit = checkRateLimit(`chat:${user.id}`, 20, 60_000);
  if (!rateLimit.allowed) return jsonError("chat.quotaReached.title", 429);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return jsonError("Invalid request", 400);
  }
  const { conversationId, content, modelSlug, attachmentIds = [] } = parsed.data;

  const supabase = await createServerSupabaseClient();

  // 1. Resolve or create conversation.
  let conversation;
  let isNewConversation = false;
  if (conversationId) {
    const { data, error } = await supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle();
    if (error || !data) return jsonError("Conversation not found", 404);
    conversation = data;
  } else {
    const { data, error } = await supabase
      .from("conversations")
      .insert({ user_id: user.id, title: "New conversation" })
      .select()
      .single();
    if (error || !data) return jsonError("Could not create conversation", 500);
    conversation = data;
    isNewConversation = true;
  }

  // 2. Resolve model and access check.
  let model = modelSlug ? await getModelBySlug(modelSlug) : null;
  if (!model && conversation.model_id) {
    const { data } = await supabase.from("models").select("*").eq("id", conversation.model_id).maybeSingle();
    model = data ?? null;
  }
  if (!model) model = await getDefaultModel();
  if (!model) return jsonError("No model available", 503);

  const accessDenied = await checkModelAccess(user.id, model);
  if (accessDenied) return jsonError(accessDenied.errorKey, accessDenied.status);

  // 3. Resolve attachments.
  //
  // The per-message cap is an entitlement, so it is enforced here as well
  // as in the composer. The schema's `.max(10)` is only a parser bound
  // against an absurd payload; the real limit is per plan and can be
  // raised for one account, so it has to be resolved per request.
  const maxAttachments = await getEffectiveNumber(user.id, "max_attachments_per_message", 5);
  if (attachmentIds.length > Math.max(1, Math.round(maxAttachments) || 5)) {
    return NextResponse.json(
      { error: "chat.tooManyAttachments", limit: Math.round(maxAttachments) },
      { status: 400 },
    );
  }

  let attachments: AttachmentRow[] = [];
  if (attachmentIds.length > 0) {
    const { data } = await supabase
      .from("attachments")
      .select("*")
      .in("id", attachmentIds)
      .eq("owner_id", user.id)
      .eq("status", "ready");
    attachments = data ?? [];
  }

  const hasImage = attachments.some((a) => a.kind === "image");
  if (hasImage && !model.capabilities.includes("vision")) {
    const visionModel = await getDefaultVisionModel();
    if (visionModel) model = visionModel;
  }

  const category = hasImage && model.capabilities.includes("vision") ? "vision_requests" : "messages";
  const quota = await checkQuota(user.id, category);
  if (!quota.allowed) {
    return jsonError("chat.quotaReached.title", 429);
  }

  // 4. Persist user message.
  const { data: userMessage, error: userMessageError } = await supabase
    .from("messages")
    .insert({ conversation_id: conversation.id, user_id: user.id, role: "user", content, status: "complete" })
    .select()
    .single();
  if (userMessageError || !userMessage) return jsonError("Could not save message", 500);

  if (attachments.length > 0) {
    await supabase
      .from("message_attachments")
      .insert(attachments.map((a) => ({ message_id: userMessage.id, attachment_id: a.id })));
  }

  // 5. Build conversation history.
  const history = await loadConversationHistory(conversation.id);
  const documentAttachments = attachments.filter((a) => a.kind !== "image" && a.processed_content);
  let userContent = await buildUserContentWithAttachments(content, attachments);
  if (documentAttachments.length > 0) {
    const { wrapUntrustedDocument } = await import("@/files/processors");
    const docsText = documentAttachments
      .map((a) => wrapUntrustedDocument(a.original_filename, a.processed_content ?? ""))
      .join("\n\n");
    userContent = typeof userContent === "string" ? `${content}\n\n${docsText}` : [...userContent, { type: "text" as const, text: docsText }];
  }

  const conversationHistory: ChatMessageInput[] = [...history, { role: "user", content: userContent }];

  // 6. Create assistant placeholder message.
  const { data: assistantMessage, error: assistantError } = await supabase
    .from("messages")
    .insert({ conversation_id: conversation.id, user_id: user.id, role: "assistant", status: "streaming" })
    .select()
    .single();
  if (assistantError || !assistantMessage) return jsonError("Could not create assistant message", 500);

  const { data: variant } = await supabase
    .from("message_variants")
    .insert({ message_id: assistantMessage.id, sequence: 1, model_id: model.id })
    .select()
    .single();

  if (variant) {
    await supabase.from("messages").update({ active_variant_id: variant.id }).eq("id", assistantMessage.id);
  }

  try {
    await consumeQuota(user.id, category);
  } catch {
    // The earlier checkQuota() pre-check above (step 2's `category` quota
    // check) is a cheap read, not the real gate — consumeQuota's atomic
    // RPC is, and it can still say "over limit" here if concurrent
    // requests raced past the pre-check together. Mark the placeholder
    // message as failed rather than silently leaving it stuck in
    // "streaming" forever.
    await supabase.from("messages").update({ status: "error" }).eq("id", assistantMessage.id);
    return jsonError("chat.quotaReached.title", 429);
  }

  return runAssistantTurn({
    model,
    conversationHistory,
    conversationId: conversation.id,
    assistantMessageId: assistantMessage.id,
    variantId: variant?.id ?? "",
    titleSourceText: isNewConversation ? content : undefined,
    signal: request.signal,
  });
}
