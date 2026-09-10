import "server-only";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { streamAssistantResponse } from "@/ai/gateway";
import { streamChunksAsResponse } from "@/lib/streaming";
import { GatewayError, type ChatMessageInput, type StreamChunk } from "@/ai/types";
import { deriveTitle } from "@/ai/conversation";
import { logger } from "@/lib/logger";
import type { ModelRow } from "@/ai/registry";
import type { Json, UpdateOf } from "@/types/database";

import { extractAndSaveMemories, type ExtractedFact } from "@/ai/memory/extractor";
import { cleanSafetyPrefix } from "@/ai/providers/openrouter";

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

async function* streamWithMemories(
  source: AsyncGenerator<StreamChunk>,
  memPromise: Promise<ExtractedFact[]>,
): AsyncGenerator<StreamChunk> {
  let doneChunk: StreamChunk | null = null;
  for await (const chunk of source) {
    if (chunk.type === "done") {
      doneChunk = chunk;
    } else {
      yield chunk;
    }
  }

  // Before emitting the stream end/done, check if memories were saved.
  // We keep this check tight (300ms) so the completed turn never hangs
  // waiting for background memory extraction while the user is looking at a finished answer.
  try {
    const savedMemories = await Promise.race([
      memPromise,
      new Promise<ExtractedFact[]>((resolve) => setTimeout(() => resolve([]), 300)),
    ]);
    if (savedMemories && savedMemories.length > 0) {
      yield {
        type: "memory_saved",
        memories: savedMemories.map((m) => ({ category: m.category, content: m.content })),
      };
    }
  } catch {
    // Non-blocking
  }

  if (doneChunk) {
    yield doneChunk;
  }
}

// Streams model turn and persists results to database.
export async function runAssistantTurn(params: RunTurnParams): Promise<Response> {
  const supabase = await createServerSupabaseClient();

  // The model this turn actually ran on. Only known once the provider
  // answers — which now happens after the response has already started —
  // so it is captured here and read by the persistence step below.
  let resolvedModel = params.model;

  // Concurrently run memory extraction in background while the model streams
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

  const memoryPromise: Promise<ExtractedFact[]> =
    params.userId && userText
      ? extractAndSaveMemories({
          userId: params.userId,
          conversationId: params.conversationId,
          userText,
          conversationHistory: params.conversationHistory,
        }).catch((err) => {
          logger.warn("background_memory_extract_error", { error: String(err) });
          return [];
        })
      : Promise.resolve([]);

  const pending = (params.pendingStream ??
    streamAssistantResponse({
      model: params.model,
      conversationHistory: params.conversationHistory,
      userId: params.userId,
      signal: params.signal,
    }))
    .then((result) => {
      resolvedModel = result.resolvedModel;
      return streamWithMemories(result.chunks, memoryPromise);
    })
    .catch(async (error) => {
      // The connection is already open, so a failure has to be delivered
      // *in* the stream rather than as a status code. Returning an error
      // chunk keeps one code path for "the model failed", whether that
      // happened before the first token or halfway through.
      const gwError = error instanceof GatewayError ? error : new GatewayError("unknown", String(error));
      logger.warn("chat_model_call_failed", { code: gwError.code });
      let db = supabase;
      try {
        db = createServiceRoleClient();
      } catch {
        db = supabase;
      }
      await db
        .from("message_variants")
        .update({ error: { code: gwError.code, message: gwError.message } })
        .eq("id", params.variantId);
      await db.from("messages").update({ status: "error" }).eq("id", params.assistantMessageId);

      async function* failed(): AsyncGenerator<StreamChunk> {
        yield { type: "error", code: gwError.code, message: gwError.message };
      }
      return failed();
    });

  return streamChunksAsResponse(pending, async (chunks) => {
    const textParts: string[] = [];
    const reasoningParts: string[] = [];
    let finishReason = "stopped";
    let usage: Record<string, unknown> | undefined;
    let errorInfo: { code: string; message: string } | undefined;
    let savedMemories: Array<{ category: string; content: string }> | undefined;

    for (const chunk of chunks) {
      if (chunk.type === "delta") textParts.push(chunk.text);
      else if (chunk.type === "reasoning_delta") reasoningParts.push(chunk.text);
      else if (chunk.type === "done") {
        finishReason = chunk.finishReason;
        usage = chunk.usage as Record<string, unknown> | undefined;
      } else if (chunk.type === "error") {
        errorInfo = { code: chunk.code, message: chunk.message };
      } else if (chunk.type === "memory_saved") {
        savedMemories = chunk.memories;
      }
    }

    const finalContent = cleanSafetyPrefix(textParts.join(""));
    const status = errorInfo ? "error" : finishReason === "stopped" && !usage ? "stopped" : "complete";

    try {
      const mergedUsage: Record<string, unknown> = {
        ...(usage ?? {}),
        ...(savedMemories && savedMemories.length > 0 ? { saved_memories: savedMemories } : {}),
      };

      let db = supabase;
      try {
        db = createServiceRoleClient();
      } catch {
        db = supabase;
      }

      const { error: variantError } = await db
        .from("message_variants")
        .update({
          content: finalContent,
          reasoning_summary: reasoningParts.join("") || null,
          finish_reason: finishReason,
          usage: mergedUsage as Json,
          error: errorInfo ?? null,
          model_id: resolvedModel.id,
        })
        .eq("id", params.variantId);

      if (variantError) {
        logger.error("message_variant_persist_failed", {
          error: variantError.message,
          variantId: params.variantId,
        });
      }

      const { error: messageError } = await db
        .from("messages")
        .update({ content: finalContent, status })
        .eq("id", params.assistantMessageId);

      if (messageError) {
        logger.error("message_persist_failed", {
          error: messageError.message,
          messageId: params.assistantMessageId,
        });
      }

      const conversationUpdate: UpdateOf<"conversations"> = {
        last_message_at: new Date().toISOString(),
        model_id: resolvedModel.id,
      };
      if (params.titleSourceText) {
        const { data: conv } = await db
          .from("conversations")
          .select("title")
          .eq("id", params.conversationId)
          .maybeSingle();
        if (!conv || conv.title === "New conversation") {
          conversationUpdate.title = deriveTitle(params.titleSourceText);
        }
      }
      const { error: convError } = await db
        .from("conversations")
        .update(conversationUpdate)
        .eq("id", params.conversationId);

      if (convError) {
        logger.error("conversation_persist_failed", {
          error: convError.message,
          conversationId: params.conversationId,
        });
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
