import "server-only";
import { logger } from "@/lib/logger";
import { openRouterAdapter } from "@/ai/providers/openrouter";
import { getProviderById, resolveFallbackChain, type ModelRow } from "@/ai/registry";
import { getActiveSystemPrompt } from "@/ai/system-prompt";
import type { ReasoningMode } from "@/ai/types";
import { GatewayError, type ChatMessageInput, type StreamChunk, type TextProviderAdapter } from "@/ai/types";

const TEXT_ADAPTERS: Record<string, TextProviderAdapter> = {
  openrouter: openRouterAdapter,
};

async function resolveAdapter(model: ModelRow): Promise<TextProviderAdapter> {
  const provider = await getProviderById(model.provider_id);
  if (!provider || !provider.enabled) {
    throw new GatewayError("model_unavailable", "This model's provider is currently disabled.");
  }
  const adapter = TEXT_ADAPTERS[provider.slug];
  if (!adapter) {
    throw new GatewayError("not_configured", `No adapter registered for provider '${provider.slug}'.`);
  }
  return adapter;
}

export interface AssistantStreamParams {
  model: ModelRow;
  conversationHistory: ChatMessageInput[];
  signal?: AbortSignal;
}

export interface AssistantStreamResult {
  chunks: AsyncGenerator<StreamChunk>;
  /** The model that actually produced the response, after fallback resolution. */
  resolvedModel: ModelRow;
}

// Streams LLM response with system prompt injection and provider fallback.
export async function streamAssistantResponse(params: AssistantStreamParams): Promise<AssistantStreamResult> {
  const systemPrompt = await getActiveSystemPrompt();
  const messages: ChatMessageInput[] = [{ role: "system", content: systemPrompt }, ...params.conversationHistory];
  const chain = await resolveFallbackChain(params.model);

  let lastError: GatewayError | null = null;

  for (const candidate of chain) {
    try {
      const adapter = await resolveAdapter(candidate);
      // Probe capability before committing: if a fallback lacks vision but
      // the conversation includes an image, skip it rather than fail
      // opaquely mid-stream.
      const needsVision = params.conversationHistory.some(
        (m) => Array.isArray(m.content) && m.content.some((p) => p.type === "image_url"),
      );
      if (needsVision && !candidate.capabilities.includes("vision")) {
        continue;
      }

      const generator = adapter.streamChat({
        providerModelId: candidate.provider_model_id,
        messages,
        signal: params.signal,
        // Read from the candidate, not the requested model: a fallback
        // must behave like the slot the person chose. Falling back from a
        // no-thinking slot to a model that thinks out loud would be a
        // visible change in behaviour they never asked for.
        reasoningMode: (candidate.reasoning_mode as ReasoningMode | undefined) ?? "auto",
      });

      // Force the first chunk now so failures during connection setup
      // trigger fallback instead of surfacing as a stream that starts then
      // silently dies.
      const firstResult = await generator.next();
      return {
        resolvedModel: candidate,
        chunks: prependAndContinue(firstResult, generator),
      };
    } catch (error) {
      lastError =
        error instanceof GatewayError ? error : new GatewayError("unknown", error instanceof Error ? error.message : String(error));
      logger.warn("model_fallback_triggered", {
        model: candidate.slug,
        code: lastError.code,
        message: lastError.message,
      });
    }
  }

  throw lastError ?? new GatewayError("model_unavailable", "No model in the fallback chain is currently available.");
}

async function* prependAndContinue(
  first: IteratorResult<StreamChunk>,
  rest: AsyncGenerator<StreamChunk>,
): AsyncGenerator<StreamChunk> {
  if (!first.done) yield first.value;
  yield* rest;
}
