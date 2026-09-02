import { NextResponse } from "next/server";
import { getEffectiveNumber } from "@/billing/entitlements";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getDefaultModel, getDefaultVisionModel, getModelBySlug } from "@/ai/registry";
import { checkModelAccess } from "@/ai/access";
import { checkQuota, consumeQuota } from "@/usage/quota";
import { runAssistantTurn } from "@/ai/run-turn";
import { streamAssistantResponse } from "@/ai/gateway";
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

  // Everything that does not depend on anything else, at once.
  //
  // This route used to run a dozen Supabase round trips strictly in
  // sequence before it opened the model connection. Each one costs
  // ~250ms from the app to the database region, so the person watching
  // the screen waited three seconds before the request that actually
  // produces their answer had even been sent. None of these four depend
  // on each other, so none of them should wait for the others.
  // Start the entitlement load before anything needs it.
  //
  // `getEffective*` share one `cache()`-memoised fetch per request, so
  // whoever calls first pays for it and everyone after is free. That
  // first caller used to be `checkModelAccess`, half way down the
  // waterfall, which put ~500ms of it on the critical path. Kicking it
  // off here folds that cost into work already happening.
  const entitlementsWarm = getEffectiveNumber(user.id, "max_attachments_per_message", 5);

  const [conversationResult, maxAttachments, requestedModel, attachmentRows] = await Promise.all([
    conversationId
      ? supabase.from("conversations").select("*").eq("id", conversationId).maybeSingle()
      : supabase
          .from("conversations")
          .insert({ user_id: user.id, title: "New conversation" })
          .select()
          .single(),
    // Already in flight above; awaiting the same promise costs nothing.
    // The per-message cap is an entitlement, enforced here as well as in
    // the composer: the schema's `.max()` is only a bound against an
    // absurd payload, while the real limit is per plan and can be raised
    // for one account.
    entitlementsWarm,
    modelSlug ? getModelBySlug(modelSlug) : Promise.resolve(null),
    attachmentIds.length > 0
      ? supabase
          .from("attachments")
          .select("*")
          .in("id", attachmentIds)
          .eq("owner_id", user.id)
          .eq("status", "ready")
      : Promise.resolve({ data: [] as AttachmentRow[] }),
  ]);

  if (conversationResult.error || !conversationResult.data) {
    return jsonError(conversationId ? "Conversation not found" : "Could not create conversation", conversationId ? 404 : 500);
  }
  const conversation = conversationResult.data;
  const isNewConversation = !conversationId;

  if (attachmentIds.length > Math.max(1, Math.round(maxAttachments) || 5)) {
    return NextResponse.json(
      { error: "chat.tooManyAttachments", limit: Math.round(maxAttachments) },
      { status: 400 },
    );
  }

  const attachments: AttachmentRow[] = (attachmentRows.data as AttachmentRow[] | null) ?? [];

  // Resolve the model. The registry lookups are cached, so these are
  // usually free; only the conversation's own model needs the database.
  let model = requestedModel;
  if (!model && conversation.model_id) {
    const { data } = await supabase.from("models").select("*").eq("id", conversation.model_id).maybeSingle();
    model = data ?? null;
  }
  if (!model) model = await getDefaultModel();
  if (!model) return jsonError("No model available", 503);
  const accessDenied = await checkModelAccess(user.id, model);
  if (accessDenied) return jsonError(accessDenied.errorKey, accessDenied.status);

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

  // History BEFORE the new message is written.
  //
  // This used to load after the insert, so the row just created came back
  // as part of "history" — and the same text was then appended again as
  // the current turn. Every request sent the person's message to the
  // model twice: wrong input, and paid for twice. Reading first is both
  // the fix and one less thing in the critical path.
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

  // The rows for this turn, written together.
  //
  // The user message, the assistant placeholder and its first variant do
  // not depend on one another's results — only the two follow-up writes
  // do — so they go out at once instead of three round trips deep.
  // Open the model connection now.
  //
  // It needs only the model and the history, both of which are ready —
  // and it is the slowest step in the whole request. Starting it here
  // means the ~1.4s it takes to reach the first token runs *alongside*
  // the row writes and the quota consume below, rather than after them.
  //
  // Deliberately not awaited. A rejection is handled by `runAssistantTurn`
  // when it awaits this same promise; attaching a no-op catch here keeps
  // Node from treating it as an unhandled rejection in the meantime.
  const pendingStream = streamAssistantResponse({
    model,
    conversationHistory,
    signal: request.signal,
  });
  pendingStream.catch(() => undefined);
  const [userMessageResult, assistantResult] = await Promise.all([
    supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, user_id: user.id, role: "user", content, status: "complete" })
      .select("id")
      .single(),
    supabase
      .from("messages")
      .insert({ conversation_id: conversation.id, user_id: user.id, role: "assistant", status: "streaming" })
      .select("id")
      .single(),
  ]);

  if (userMessageResult.error || !userMessageResult.data) return jsonError("Could not save message", 500);
  if (assistantResult.error || !assistantResult.data) return jsonError("Could not create assistant message", 500);

  const userMessage = userMessageResult.data;
  const assistantMessage = assistantResult.data;
  const [variantResult] = await Promise.all([
    supabase
      .from("message_variants")
      .insert({ message_id: assistantMessage.id, sequence: 1, model_id: model.id })
      .select("id")
      .single(),
    attachments.length > 0
      ? supabase
          .from("message_attachments")
          .insert(attachments.map((a) => ({ message_id: userMessage.id, attachment_id: a.id })))
      : Promise.resolve(null),
  ]);

  const variant = variantResult.data;
  if (variant) {
    // Not awaited: nothing before the first token depends on it, and the
    // persistence step at the end of the turn re-reads the variant by id.
    void supabase.from("messages").update({ active_variant_id: variant.id }).eq("id", assistantMessage.id);
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
    pendingStream,
    conversationId: conversation.id,
    assistantMessageId: assistantMessage.id,
    variantId: variant?.id ?? "",
    titleSourceText: isNewConversation ? content : undefined,
    signal: request.signal,
  });
}
