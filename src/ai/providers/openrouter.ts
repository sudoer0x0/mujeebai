import "server-only";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import {
  GatewayError,
  type ChatContentPart,
  type ChatMessageInput,
  type StreamChunk,
  type TextGenerationRequest,
  type TextProviderAdapter,
} from "@/ai/types";

// OpenRouter text and vision provider adapter.

function toOpenRouterContent(content: string | ChatContentPart[]) {
  if (typeof content === "string") return content;
  return content.map((part) =>
    part.type === "image_url"
      ? { type: "image_url", image_url: { url: part.imageUrl } }
      : { type: "text", text: part.text ?? "" },
  );
}

function toOpenRouterMessages(messages: ChatMessageInput[]) {
  return messages.map((m) => ({ role: m.role, content: toOpenRouterContent(m.content) }));
}

async function* parseSseStream(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("data:")) continue;
        const data = trimmed.slice(5).trim();
        if (data === "[DONE]") return;
        try {
          yield JSON.parse(data);
        } catch {
          // Ignore malformed keep-alive/comment lines.
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const openRouterAdapter: TextProviderAdapter = {
  slug: "openrouter",
  capabilities: ["text", "vision", "streaming", "reasoning"],

  async *streamChat(request: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    if (!providerStatus.openrouter) {
      throw new GatewayError("not_configured", "OpenRouter is not configured on this deployment.");
    }

    let response: Response;
    try {
      response = await fetch(`${serverEnv.OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}`,
          "HTTP-Referer": serverEnv.OPENROUTER_SITE_URL ?? "https://mujeebai.yungswag.xyz",
          "X-Title": serverEnv.OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model: request.providerModelId,
          messages: toOpenRouterMessages(request.messages),
          stream: true,
          temperature: request.temperature ?? 0.7,
          max_tokens: request.maxOutputTokens,
        }),
        signal: request.signal,
      });
    } catch (error) {
      logger.error("openrouter_fetch_failed", { error: String(error) });
      throw new GatewayError("provider_unavailable", "Could not reach OpenRouter.");
    }

    if (response.status === 429) {
      throw new GatewayError("rate_limited", "OpenRouter rate limit reached.");
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      logger.error("openrouter_error_response", { status: response.status, body: text.slice(0, 500) });
      throw new GatewayError("provider_error", `OpenRouter returned ${response.status}.`);
    }

    let finishReason = "stop";
    for await (const event of parseSseStream(response.body)) {
      const choice = (event as { choices?: Array<Record<string, unknown>> }).choices?.[0];
      if (!choice) continue;

      const delta = choice.delta as { content?: string; reasoning?: string } | undefined;
      if (delta?.reasoning) {
        yield { type: "reasoning_delta", text: delta.reasoning };
      }
      if (delta?.content) {
        yield { type: "delta", text: delta.content };
      }
      if (typeof choice.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }

      const usageRaw = (event as { usage?: Record<string, number> }).usage;
      if (usageRaw) {
        yield {
          type: "done",
          finishReason,
          usage: {
            promptTokens: usageRaw.prompt_tokens,
            completionTokens: usageRaw.completion_tokens,
            totalTokens: usageRaw.total_tokens,
          },
        };
        return;
      }
    }

    yield { type: "done", finishReason };
  },
};
