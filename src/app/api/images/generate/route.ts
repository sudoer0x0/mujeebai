import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { checkQuota, consumeQuota } from "@/usage/quota";
import { cloudflareImageAdapter } from "@/ai/providers/cloudflare-image";
import { createStorageAdapter } from "@/storage/factory";
import { GatewayError } from "@/ai/types";
import { serverEnv } from "@/lib/env.server";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

const bodySchema = z.object({
  prompt: z.string().min(1).max(2000),
  conversationId: z.string().uuid().optional(),
  messageId: z.string().uuid().optional(),
});

// Image generation route.
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`images:${user.id}`, 10, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "images.quotaReached" }, { status: 429 });

  if (!(await isFeatureEnabled("image_generation"))) {
    return NextResponse.json({ error: "images.failed" }, { status: 503 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const quota = await checkQuota(user.id, "image_generations");
  if (!quota.allowed) return NextResponse.json({ error: "images.quotaReached" }, { status: 429 });

  try {
    const result = await cloudflareImageAdapter.generateImage({
      prompt: parsed.data.prompt,
      providerModelId: serverEnv.CLOUDFLARE_IMAGE_MODEL,
      signal: request.signal,
    });

    await consumeQuota(user.id, "image_generations");

    const storage = createStorageAdapter();
    const extension = result.contentType.includes("jpeg") ? "jpg" : "png";
    const path = `${user.id}/generated/${nanoid()}.${extension}`;
    await storage.upload(path, Buffer.from(result.imageBase64, "base64"), {
      contentType: result.contentType,
      private: true,
    });

    const supabase = await createServerSupabaseClient();

    // Resolve or create the conversation so image generations persist in history
    let conversationId = parsed.data.conversationId;
    let isNewConversation = false;
    if (conversationId) {
      const { data: conv } = await supabase
        .from("conversations")
        .select("id")
        .eq("id", conversationId)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!conv) {
        conversationId = undefined;
      }
    }

    if (!conversationId) {
      const { deriveTitle } = await import("@/ai/conversation");
      const { data: newConv } = await supabase
        .from("conversations")
        .insert({
          user_id: user.id,
          title: deriveTitle(parsed.data.prompt),
        })
        .select("id")
        .single();
      if (newConv) {
        conversationId = newConv.id;
        isNewConversation = true;
      }
    }

    // Record the asset first so the message can reference it by a stable
    // id. Persisting the signed URL itself would leave every generated
    // image in the user's history broken an hour later — see
    // src/app/api/assets/[id]/route.ts.
    const { data: asset, error: assetError } = await supabase
      .from("generated_assets")
      .insert({
        owner_id: user.id,
        type: "image",
        storage_path: path,
        prompt: parsed.data.prompt,
        conversation_id: conversationId ?? null,
      })
      .select()
      .single();

    if (assetError || !asset) {
      return NextResponse.json({ error: "images.failed" }, { status: 500 });
    }

    const url = `/api/assets/${asset.id}`;

    let userMessageId = parsed.data.messageId;
    let assistantMessageId: string | undefined;

    if (conversationId) {
      // 1. User prompt message
      const { data: userMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "user",
          content: parsed.data.prompt,
          status: "complete",
        })
        .select("id")
        .single();
      if (userMsg) userMessageId = userMsg.id;

      // 2. Assistant image message
      const markdownImage = `![${parsed.data.prompt.replace(/[[\]]/g, "")}](${url})`;
      const { data: assistantMsg } = await supabase
        .from("messages")
        .insert({
          conversation_id: conversationId,
          user_id: user.id,
          role: "assistant",
          content: markdownImage,
          status: "complete",
        })
        .select("id")
        .single();

      if (assistantMsg) {
        assistantMessageId = assistantMsg.id;
        const { data: variant } = await supabase
          .from("message_variants")
          .insert({
            message_id: assistantMsg.id,
            sequence: 1,
            content: markdownImage,
          })
          .select("id")
          .single();

        if (variant) {
          await supabase
            .from("messages")
            .update({ active_variant_id: variant.id })
            .eq("id", assistantMsg.id);
        }
      }

      await supabase
        .from("conversations")
        .update({ last_message_at: new Date().toISOString() })
        .eq("id", conversationId);
    }

    // Link the asset back to the message it was rendered into, now that
    // the message exists.
    if (assistantMessageId ?? userMessageId) {
      await supabase
        .from("generated_assets")
        .update({ message_id: assistantMessageId ?? userMessageId ?? null, conversation_id: conversationId ?? null })
        .eq("id", asset.id);
    }

    return NextResponse.json({
      id: asset.id,
      url,
      conversationId,
      messageId: assistantMessageId,
      isNewConversation,
    });
  } catch (error) {
    const gwError = error instanceof GatewayError ? error : new GatewayError("unknown", String(error));
    if (gwError.code === "quota_exceeded") {
      return NextResponse.json({ error: "images.quotaReached" }, { status: 429 });
    }
    const status = gwError.code === "not_configured" ? 503 : gwError.code === "rate_limited" ? 429 : 502;
    return NextResponse.json({ error: "images.failed" }, { status });
  }
}
