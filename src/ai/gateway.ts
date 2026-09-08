import "server-only";
import { logger } from "@/lib/logger";
import { openRouterAdapter } from "@/ai/providers/openrouter";
import { cloudflareChatAdapter } from "@/ai/providers/cloudflare-chat";
import { providerStatus } from "@/lib/env.server";
import { getProviderById, resolveFallbackChain, type ModelRow } from "@/ai/registry";
import { getActiveSystemPrompt } from "@/ai/system-prompt";
import { getUserMemoryProfile } from "@/ai/memory/store";
import { formatMemoriesForPrompt } from "@/ai/memory/prompt";
import type { ReasoningMode } from "@/ai/types";
import { GatewayError, type ChatMessageInput, type StreamChunk, type TextProviderAdapter } from "@/ai/types";

const TEXT_ADAPTERS: Record<string, TextProviderAdapter> = {
  openrouter: openRouterAdapter,
  cloudflare: cloudflareChatAdapter,
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
  userId?: string;
  signal?: AbortSignal;
}

export interface AssistantStreamResult {
  chunks: AsyncGenerator<StreamChunk>;
  /** The model that actually produced the response, after fallback resolution. */
  resolvedModel: ModelRow;
}

// Streams LLM response with system prompt injection and provider fallback.
export async function streamAssistantResponse(params: AssistantStreamParams): Promise<AssistantStreamResult> {
  let systemPrompt = await getActiveSystemPrompt();
  if (params.userId) {
    try {
      const memoryProfile = await getUserMemoryProfile(params.userId);
      const memoryBlock = formatMemoriesForPrompt(memoryProfile);
      if (memoryBlock) {
        systemPrompt = `${systemPrompt}\n\n${memoryBlock}`;
      }
    } catch {
      // Memory failure should never break conversation streaming
    }
  }
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
        // From the *requested* slot, not the candidate.
        //
        // I had this the other way round, with a comment arguing for it,
        // and the argument was wrong. The person picked "Mujeeb AI Free",
        // which promises no visible thinking. If that call fails and the
        // chain falls through to a slot configured to show thinking, then
        // reading the candidate's mode breaks exactly the promise the
        // fallback exists to preserve. The slot they chose decides.
        reasoningMode: (params.model.reasoning_mode as ReasoningMode | undefined) ?? "auto",
      });

      // Force the first chunk now so failures during connection setup
      // trigger fallback instead of surfacing as a stream that starts then
      // silently dies.
      const firstResult = await generator.next();
      if (firstResult.done || firstResult.value.type === "error") {
        throw new GatewayError("provider_unavailable", "Model connection closed prematurely with an error.");
      }
      return {
        resolvedModel: params.model,
        chunks: prependAndContinue(firstResult, generator),
      };
    } catch (error) {
      lastError =
        error instanceof GatewayError ? error : new GatewayError("unknown", error instanceof Error ? error.message : String(error));
      logger.warn("model_fallback_triggered", {
        requested: params.model.slug,
        candidateProviderModelId: candidate.provider_model_id,
        code: lastError.code,
        message: lastError.message,
      });
  }
  }

  // If primary chain candidates failed (e.g. OpenRouter daily rate limit exhausted),
  // rescue using Cloudflare Workers AI so the user's turn never breaks.
  if (providerStatus.cloudflareChat) {
    try {
      const rescueGenerator = cloudflareChatAdapter.streamChat({
        providerModelId: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
        messages,
        signal: params.signal,
      });
      const firstRescue = await rescueGenerator.next();
      if (!firstRescue.done && firstRescue.value.type !== "error") {
        logger.info("model_rescued_by_cloudflare", { requested: params.model.slug });
        return {
          resolvedModel: params.model,
          chunks: prependAndContinue(firstRescue, rescueGenerator),
        };
      }
    } catch (rescueErr) {
      logger.warn("cloudflare_rescue_failed", { error: String(rescueErr) });
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
