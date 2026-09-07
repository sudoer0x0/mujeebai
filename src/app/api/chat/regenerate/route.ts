import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getModelBySlug, listModels } from "@/ai/registry";
import { checkModelAccess } from "@/ai/access";
import { checkQuota, consumeQuota } from "@/usage/quota";
import { loadConversationHistory } from "@/ai/conversation";
import { runAssistantTurn } from "@/ai/run-turn";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 120;

const bodySchema = z.object({
  messageId: z.string().uuid(),
  modelSlug: z.string().optional(),
});

// Regenerates an assistant response variant.
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`chat:${user.id}`, 20, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: message } = await supabase
    .from("messages")
    .select("*, conversations(*)")
    .eq("id", parsed.data.messageId)
    .eq("user_id", user.id)
    .eq("role", "assistant")
    .maybeSingle();

  if (!message) return NextResponse.json({ error: "Message not found" }, { status: 404 });

  let model = null;
  if (parsed.data.modelSlug) {
    model = await getModelBySlug(parsed.data.modelSlug);
  } else if (message.active_variant_id) {
    const { data: activeVariant } = await supabase
      .from("message_variants")
      .select("model_id")
      .eq("id", message.active_variant_id)
      .maybeSingle();
    if (activeVariant?.model_id) {
      model = (await listModels()).find((m) => m.id === activeVariant.model_id) ?? null;
    }
  }

  const resolvedModel = model ?? (await getModelBySlug("mujeeb-free"));
  if (!resolvedModel) return NextResponse.json({ error: "No model available" }, { status: 503 });

  const accessDenied = await checkModelAccess(user.id, resolvedModel);
  if (accessDenied) return NextResponse.json({ error: accessDenied.errorKey }, { status: accessDenied.status });

  const category = "messages" as const;
  const quota = await checkQuota(user.id, category);
  if (!quota.allowed) return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });

  // History up to (not including) this assistant message.
  const fullHistory = await loadConversationHistory(message.conversation_id);
  const { data: priorMessages } = await supabase
    .from("messages")
    .select("id")
    .eq("conversation_id", message.conversation_id)
    .lt("created_at", message.created_at)
    .order("created_at", { ascending: true });
  const historyUpToThis = fullHistory.slice(0, priorMessages?.length ?? fullHistory.length);

  const { data: existingVariants } = await supabase
    .from("message_variants")
    .select("sequence")
    .eq("message_id", message.id)
    .order("sequence", { ascending: false })
    .limit(1);

  const nextSequence = (existingVariants?.[0]?.sequence ?? 0) + 1;

  const { data: variant } = await supabase
    .from("message_variants")
    .insert({ message_id: message.id, sequence: nextSequence, model_id: resolvedModel.id })
    .select()
    .single();

  if (!variant) return NextResponse.json({ error: "Could not create variant" }, { status: 500 });

  await supabase
    .from("messages")
    .update({ active_variant_id: variant.id, status: "streaming" })
    .eq("id", message.id);

  try {
    await consumeQuota(user.id, category);
  } catch {
    // See the equivalent comment in src/app/api/chat/route.ts — the
    // earlier checkQuota() above is a cheap pre-check, not the real gate.
    await supabase.from("messages").update({ status: "error" }).eq("id", message.id);
    return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });
  }

  return runAssistantTurn({
    model: resolvedModel,
    conversationHistory: historyUpToThis,
    conversationId: message.conversation_id,
    assistantMessageId: message.id,
    variantId: variant.id,
    userId: user.id,
    signal: request.signal,
  });
}
