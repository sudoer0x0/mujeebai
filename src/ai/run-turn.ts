import "server-only";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { streamAssistantResponse } from "@/ai/gateway";
import { streamChunksAsResponse } from "@/lib/streaming";
import { GatewayError, type ChatMessageInput, type StreamChunk } from "@/ai/types";
import { deriveTitle } from "@/ai/conversation";
import { logger } from "@/lib/logger";
import type { ModelRow } from "@/ai/registry";
import type { UpdateOf } from "@/types/database";

import { extractAndSaveMemories } from "@/ai/memory/extractor";

export interface RunTurnParams {
  model: ModelRow;
  conversationHistory: ChatMessageInput[];
  conversationId: string;
  assistantMessageId: string;
  variantId: string;
  userId?: string;
  /** Set the conversation title from this text if it's still the placeholder title. */
  titleSourceText?: string;
  signal?: AbortSignal;
  /**
   * A model call that has already been started.
   *
   * Opening the connection to the provider is the single slowest step in
   * a turn — around 1.4s to the first token — and it depends only on the
   * model and the history. Starting it in the route, before the rows for
   * this turn are written, lets that latency overlap the database work
   * instead of following it. When absent, the call is made here as
   * before, which keeps the other callers (regenerate, edit) unchanged.
   */
  pendingStream?: Promise<Awaited<ReturnType<typeof streamAssistantResponse>>>;
}

// Streams model turn and persists results to database.
export async function runAssistantTurn(params: RunTurnParams): Promise<Response> {
  const supabase = await createServerSupabaseClient();

  // The model this turn actually ran on. Only known once the provider
  // answers — which now happens after the response has already started —
  // so it is captured here and read by the persistence step below.
  let resolvedModel = params.model;

  const pending = (params.pendingStream ??
    streamAssistantResponse({
      model: params.model,
      conversationHistory: params.conversationHistory,
      userId: params.userId,
      signal: params.signal,
    }))
    .then((result) => {
      resolvedModel = result.resolvedModel;
      return result.chunks;
    })
    .catch(async (error) => {
      // The connection is already open, so a failure has to be delivered
      // *in* the stream rather than as a status code. Returning an error
      // chunk keeps one code path for "the model failed", whether that
      // happened before the first token or halfway through.
      const gwError = error instanceof GatewayError ? error : new GatewayError("unknown", String(error));
      logger.warn("chat_model_call_failed", { code: gwError.code });
      await supabase
        .from("message_variants")
        .update({ error: { code: gwError.code, message: gwError.message } })
        .eq("id", params.variantId);
      await supabase.from("messages").update({ status: "error" }).eq("id", params.assistantMessageId);

      async function* failed(): AsyncGenerator<StreamChunk> {
        yield { type: "error", code: gwError.code, message: gwError.message };
      }
      return failed();
    });

  return streamChunksAsResponse(pending, async (chunks) => {
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

      // Asynchronously extract and save user memories without blocking the response
      if (status === "complete" && params.userId) {
        const lastTurn = params.conversationHistory[params.conversationHistory.length - 1];
        const userText =
          typeof lastTurn?.content === "string"
            ? lastTurn.content
            : Array.isArray(lastTurn?.content)
              ? lastTurn.content
                  .filter((p) => p.type === "text")
                  .map((p) => p.text)
                  .join(" ")
              : "";

        if (userText) {
          try {
            await extractAndSaveMemories({
              userId: params.userId!,
              conversationId: params.conversationId,
              userText,
            });
          } catch (err) {
            logger.warn("background_memory_extract_error", { error: String(err) });
          }
        }
      }
    } catch (error) {
      logger.error("chat_persist_failed", { error: String(error), conversationId: params.conversationId });
    }
  }, {
    "X-Conversation-Id": params.conversationId,
    "X-Message-Id": params.assistantMessageId,
    // What was *requested*. The model actually used is only known after
    // the provider answers, which is now after these headers are sent —
    // a fallback swap is recorded on the variant row, which is where
    // anything auditing this should look.
    "X-Model-Slug": params.model.slug,
  });
}
