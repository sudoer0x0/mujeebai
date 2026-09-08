import "server-only";
import dns from "node:dns";
import { serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";

try {
  dns.setDefaultResultOrder?.("ipv4first");
} catch {
  // Ignore
}
import {
  GatewayError,
  type ChatContentPart,
  type ChatMessageInput,
  type StreamChunk,
  type TextGenerationRequest,
  type TextProviderAdapter,
} from "@/ai/types";

function toCloudflareContent(content: string | ChatContentPart[]): string {
  if (typeof content === "string") return content;
  return content
    .filter((part) => part.type === "text" && part.text)
    .map((part) => part.text)
    .join(" ");
}

function toCloudflareMessages(messages: ChatMessageInput[]) {
  return messages.map((m) => ({
    role: m.role,
    content: toCloudflareContent(m.content),
  }));
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
          // Ignore keep-alive or comment lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

export const cloudflareChatAdapter: TextProviderAdapter = {
  slug: "cloudflare",
  capabilities: ["text", "streaming"],

  async *streamChat(request: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    if (!serverEnv.CLOUDFLARE_ACCOUNT_ID || !serverEnv.CLOUDFLARE_API_TOKEN) {
      throw new GatewayError("not_configured", "Cloudflare Workers AI is not configured on this deployment.");
    }

    const model = request.providerModelId.startsWith("@cf/")
      ? request.providerModelId
      : "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

    const url = `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model}`;

    let response: Response;
    try {
      response = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverEnv.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: toCloudflareMessages(request.messages),
          stream: true,
          max_tokens: request.maxOutputTokens ?? 1024,
        }),
        signal: request.signal,
      });
    } catch (error) {
      logger.error("cloudflare_chat_fetch_failed", { error: String(error) });
      throw new GatewayError("provider_unavailable", "Could not reach Cloudflare Workers AI.");
    }

    if (response.status === 429) {
      throw new GatewayError("rate_limited", "Cloudflare Workers AI rate limit reached.");
    }
    if (!response.ok || !response.body) {
      const text = await response.text().catch(() => "");
      logger.error("cloudflare_chat_error_response", { status: response.status, body: text.slice(0, 500) });
      throw new GatewayError("provider_error", `Cloudflare Workers AI returned ${response.status}.`);
    }

    let finishReason = "stop";
    let hasYieldedContent = false;
    for await (const event of parseSseStream(response.body)) {
      const choice = (event as { choices?: Array<Record<string, unknown>> }).choices?.[0];
      const delta = choice?.delta as { content?: string } | undefined;
      if (delta?.content) {
        hasYieldedContent = true;
        yield { type: "delta", text: delta.content };
      }
      if (typeof choice?.finish_reason === "string" && choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }

    if (!hasYieldedContent) {
      throw new GatewayError("provider_unavailable", "Model returned 0 content tokens.");
    }

    yield { type: "done", finishReason };
  },
};
