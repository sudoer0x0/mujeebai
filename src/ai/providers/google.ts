import "server-only";
import { GoogleGenAI } from "@google/genai";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import {
  GatewayError,
  type ChatMessageInput,
  type StreamChunk,
  type TextGenerationRequest,
  type TextProviderAdapter,
} from "@/ai/types";

// Singleton Google GenAI client instance initialized with Gemini API key.
let googleAiClient: GoogleGenAI | null = null;

function getClient(): GoogleGenAI {
  if (!providerStatus.google || !serverEnv.GEMINI_API_KEY) {
    throw new GatewayError("not_configured", "Google Gemini API key is not configured on this deployment.");
  }
  if (!googleAiClient) {
    googleAiClient = new GoogleGenAI({ apiKey: serverEnv.GEMINI_API_KEY });
  }
  return googleAiClient;
}

/**
 * Resolves requested provider model ID to Google's official endpoints.
 * Automatically handles aliases so calls remain blazing fast and future-proof.
 */
export function resolveGoogleModelId(id: string): string {
  const normalized = id.toLowerCase().trim();
  if (normalized.includes("3.5-flash-lite") || normalized === "gemini-2.5-flash-lite" || normalized === "fast") {
    return "gemini-3.5-flash-lite";
  }
  if (normalized.includes("3.6-flash") || normalized === "gemini-2.5-flash" || normalized === "think") {
    return "gemini-3.6-flash";
  }
  return id;
}

/**
 * Converts internal chat messages into Google GenAI format:
 * - Extracts system messages into a dedicated systemInstruction.
 * - Converts "assistant" role to "model".
 * - Converts image attachments (data URLs) into inlineData parts.
 */
export function toGeminiContents(messages: ChatMessageInput[]): {
  systemInstruction?: string;
  contents: Array<{
    role: "user" | "model";
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }>;
} {
  const rawContents: Array<{
    role: "user" | "model";
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }> = [];

  const systemParts: string[] = [];

  for (const message of messages) {
    if (message.role === "system") {
      const text = typeof message.content === "string"
        ? message.content
        : message.content.map((p) => p.text ?? "").join("\n");
      if (text.trim()) systemParts.push(text.trim());
      continue;
    }

    const role = message.role === "assistant" ? "model" : "user";
    const parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }> = [];

    if (typeof message.content === "string") {
      const trimmed = message.content.trim();
      if (trimmed.length > 0) {
        parts.push({ text: trimmed });
      }
    } else if (Array.isArray(message.content)) {
      for (const part of message.content) {
        if (part.type === "text" && part.text && part.text.trim().length > 0) {
          parts.push({ text: part.text.trim() });
        } else if (part.type === "image_url" && part.imageUrl) {
          const match = part.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
          if (match) {
            parts.push({
              inlineData: {
                mimeType: match[1],
                data: match[2],
              },
            });
          } else {
            // Fallback for plain URL if not already base64
            parts.push({ text: `[Image: ${part.imageUrl}]` });
          }
        } else if (part.type === "media") {
          if (part.media?.data && part.media?.mimeType) {
            parts.push({
              inlineData: {
                mimeType: part.media.mimeType,
                data: part.media.data,
              },
            });
          } else if (part.imageUrl) {
            const match = part.imageUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (match) {
              parts.push({
                inlineData: {
                  mimeType: match[1],
                  data: match[2],
                },
              });
            }
          }
        }
      }
    }

    if (parts.length > 0) {
      rawContents.push({ role, parts });
    }
  }

  // Merge consecutive turns with identical roles to prevent SDK invalid argument errors
  const contents: Array<{
    role: "user" | "model";
    parts: Array<{ text?: string; inlineData?: { mimeType: string; data: string } }>;
  }> = [];

  for (const turn of rawContents) {
    const prev = contents[contents.length - 1];
    if (prev && prev.role === turn.role) {
      prev.parts.push(...turn.parts);
    } else {
      contents.push(turn);
    }
  }

  // Gemini requires the conversation contents to start with 'user'
  if (contents.length === 0 || contents[0].role !== "user") {
    contents.unshift({
      role: "user",
      parts: [{ text: "Hello" }],
    });
  }

  return {
    systemInstruction: systemParts.length > 0 ? systemParts.join("\n\n") : undefined,
    contents,
  };
}

export const googleChatAdapter: TextProviderAdapter = {
  slug: "google",
  capabilities: ["text", "vision", "streaming", "reasoning", "audio", "video"],

  async *streamChat(request: TextGenerationRequest): AsyncGenerator<StreamChunk> {
    const ai = getClient();
    const modelId = resolveGoogleModelId(request.providerModelId);
    const { systemInstruction, contents } = toGeminiContents(request.messages);

    // Fast vs. Think optimization:
    // When reasoningMode is "require" (Think), enable thinking with includeThoughts: true.
    // When reasoningMode is "exclude" (Fast), omit thinkingConfig entirely for instant TTFT and compatibility.
    const config: Record<string, unknown> = {
      systemInstruction: systemInstruction || undefined,
      temperature: request.temperature ?? 0.7,
      maxOutputTokens: request.maxOutputTokens,
      abortSignal: request.signal,
    };

    if (request.reasoningMode === "require") {
      config.thinkingConfig = {
        includeThoughts: true,
      };
    }

    let responseStream;
    try {
      responseStream = await ai.models.generateContentStream({
        model: modelId,
        contents,
        config,
      });
    } catch (err: unknown) {
      logger.error("google_gemini_init_failed", { model: modelId, error: String(err) });
      const errorStr = String(err);
      if (errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED")) {
        throw new GatewayError("rate_limited", "Google Gemini rate limit reached.");
      }
      if (errorStr.includes("503") || errorStr.includes("UNAVAILABLE")) {
        throw new GatewayError("provider_unavailable", "Google Gemini is temporarily experiencing high demand.");
      }
      throw new GatewayError("provider_error", `Google Gemini connection failed: ${err instanceof Error ? err.message : String(err)}`);
    }

    let finishReason = "stop";
    let hasYieldedContent = false;
    let lastUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;

    try {
      for await (const chunk of responseStream) {
        const candidate = chunk.candidates?.[0];
        if (candidate?.finishReason) {
          finishReason = String(candidate.finishReason).toLowerCase();
        }

        const parts = candidate?.content?.parts;
        if (Array.isArray(parts)) {
          for (const part of parts) {
            // Check for reasoning / thought parts
            if (part.thought && typeof part.text === "string" && part.text) {
              if (request.reasoningMode !== "exclude") {
                hasYieldedContent = true;
                yield { type: "reasoning_delta", text: part.text };
              }
            } else if (typeof part.text === "string" && part.text) {
              hasYieldedContent = true;
              yield { type: "delta", text: part.text };
            }
          }
        } else if (typeof chunk.text === "string" && chunk.text) {
          hasYieldedContent = true;
          yield { type: "delta", text: chunk.text };
        }

        if (chunk.usageMetadata) {
          lastUsage = {
            promptTokens: chunk.usageMetadata.promptTokenCount ?? 0,
            completionTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
            totalTokens: chunk.usageMetadata.totalTokenCount ?? 0,
          };
        }
      }
    } catch (streamErr: unknown) {
      logger.error("google_gemini_stream_interrupted", { model: modelId, error: String(streamErr) });
      const errorStr = String(streamErr);
      if (errorStr.includes("429") || errorStr.includes("RESOURCE_EXHAUSTED")) {
        throw new GatewayError("rate_limited", "Google Gemini rate limit reached.");
      }
      if (errorStr.includes("503") || errorStr.includes("UNAVAILABLE")) {
        throw new GatewayError("provider_unavailable", "Google Gemini is temporarily experiencing high demand.");
      }
      throw new GatewayError("provider_error", `Google Gemini stream error: ${streamErr instanceof Error ? streamErr.message : String(streamErr)}`);
    }

    if (!hasYieldedContent) {
      throw new GatewayError("provider_unavailable", "Google Gemini returned 0 content tokens.");
    }

    yield {
      type: "done",
      finishReason,
      usage: lastUsage,
    };
  },
};
