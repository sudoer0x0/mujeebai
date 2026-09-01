import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { streamAssistantResponse } from "@/ai/gateway";
import { streamChunksAsResponse } from "@/lib/streaming";
import { GatewayError, type ChatMessageInput } from "@/ai/types";
import { deriveTitle } from "@/ai/conversation";
import { logger } from "@/lib/logger";
import type { ModelRow } from "@/ai/registry";
import type { UpdateOf } from "@/types/database";
import { NextResponse } from "next/server";

export interface RunTurnParams {
  model: ModelRow;
  conversationHistory: ChatMessageInput[];
  conversationId: string;
  assistantMessageId: string;
  variantId: string;
  /** Set the conversation title from this text if it's still the placeholder title. */
  titleSourceText?: string;
  signal?: AbortSignal;
}

// Streams model turn and persists results to database.
export async function runAssistantTurn(params: RunTurnParams): Promise<Response> {
  const supabase = await createServerSupabaseClient();

  let resolvedModel = params.model;
  let generator;
  try {
    const result = await streamAssistantResponse({
      model: params.model,
      conversationHistory: params.conversationHistory,
      signal: params.signal,
    });
    generator = result.chunks;
    resolvedModel = result.resolvedModel;
  } catch (error) {
    const gwError = error instanceof GatewayError ? error : new GatewayError("unknown", String(error));
    await supabase
      .from("message_variants")
      .update({ error: { code: gwError.code, message: gwError.message } })
      .eq("id", params.variantId);
    await supabase.from("messages").update({ status: "error" }).eq("id", params.assistantMessageId);
    return NextResponse.json({ error: gwError.code }, { status: 502 });
  }

  return streamChunksAsResponse(generator, async (chunks) => {
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    let finishReason = "stopped";
    let usage: Record<string, number> | undefined;
    let errorInfo: { code: string; message: string } | undefined;

    for (const chunk of chunks) {
      if (chunk.type === "delta") textParts.push(chunk.text);
      else if (chunk.type === "reasoning_delta") reasoningParts.push(chunk.text);
      else if (chunk.type === "done") {
        finishReason = chunk.finishReason;
        usage = chunk.usage as Record<string, number> | undefined;
      } else if (chunk.type === "error") {
        errorInfo = { code: chunk.code, message: chunk.message };
      }
    }

    const finalContent = textParts.join("");
    const status = errorInfo ? "error" : finishReason === "stopped" && !usage ? "stopped" : "complete";

    try {
      await supabase
        .from("message_variants")
        .update({
          content: finalContent,
          reasoning_summary: reasoningParts.join("") || null,
          finish_reason: finishReason,
          usage: usage ?? {},
          error: errorInfo ?? null,
          model_id: resolvedModel.id,
        })
        .eq("id", params.variantId);

      await supabase.from("messages").update({ content: finalContent, status }).eq("id", params.assistantMessageId);

      const conversationUpdate: UpdateOf<"conversations"> = {
        last_message_at: new Date().toISOString(),
        model_id: resolvedModel.id,
      };
      if (params.titleSourceText) {
        const { data: conv } = await supabase
          .from("conversations")
          .select("title")
          .eq("id", params.conversationId)
          .maybeSingle();
        if (!conv || conv.title === "New conversation") {
          conversationUpdate.title = deriveTitle(params.titleSourceText);
        }
      }
      await supabase.from("conversations").update(conversationUpdate).eq("id", params.conversationId);
    } catch (error) {
      logger.error("chat_persist_failed", { error: String(error), conversationId: params.conversationId });
    }
  }, {
    "X-Conversation-Id": params.conversationId,
    "X-Message-Id": params.assistantMessageId,
    "X-Model-Slug": resolvedModel.slug,
  });
}
