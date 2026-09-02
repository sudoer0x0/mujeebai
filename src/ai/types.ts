// AI Gateway provider-agnostic types.

export type Capability =
  | "text"
  | "vision"
  | "streaming"
  | "reasoning"
  | "structured_output"
  | "image"
  | "audio"
  | "video";

export type ChatRole = "system" | "user" | "assistant";

export interface ChatContentPart {
  type: "text" | "image_url";
  text?: string;
  imageUrl?: string;
}

export interface ChatMessageInput {
  role: ChatRole;
  content: string | ChatContentPart[];
}

export interface NormalizedUsage {
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
}

export type StreamChunk =
  | { type: "delta"; text: string }
  | { type: "reasoning_delta"; text: string }
  | { type: "done"; finishReason: string; usage?: NormalizedUsage }
  | { type: "error"; code: GatewayErrorCode; message: string };

/** Model-agnostic error categories the UI can render a friendly message for. */
export type GatewayErrorCode =
  | "provider_unavailable"
  | "rate_limited"
  | "quota_exceeded"
  | "model_unavailable"
  | "invalid_request"
  | "provider_error"
  | "not_configured"
  | "unknown";

export class GatewayError extends Error {
  code: GatewayErrorCode;
  constructor(code: GatewayErrorCode, message: string) {
    super(message);
    this.name = "GatewayError";
    this.code = code;
  }
}

export interface ProviderModelRef {
  /** The provider's own identifier for this model, e.g. "meta-llama/llama-3.3-70b-instruct:free" */
  providerModelId: string;
}

/**
 * How a slot treats chain-of-thought.
 *
 * `exclude` is enforced twice — asked of the provider, and applied again
 * to the stream — because asking is not enough. Over four calls to
 * `openrouter/free` with `reasoning: {exclude: true}`, one still came
 * back with reasoning: the router picks a different underlying model each
 * time and they do not all honour it.
 */
export type ReasoningMode = "auto" | "exclude" | "require";

export interface TextGenerationRequest extends ProviderModelRef {
  reasoningMode?: ReasoningMode;
  messages: ChatMessageInput[];
  maxOutputTokens?: number;
  temperature?: number;
  signal?: AbortSignal;
}

/**
 * Every text/vision provider adapter implements this. Adapters must not
 * throw raw SDK/HTTP errors — they should catch and re-throw a
 * `GatewayError` so the gateway can normalize the response for the UI.
 */
export interface TextProviderAdapter {
  slug: string;
  capabilities: Capability[];
  streamChat(request: TextGenerationRequest): AsyncGenerator<StreamChunk>;
}

export interface ImageGenerationRequest {
  prompt: string;
  providerModelId: string;
  width?: number;
  height?: number;
  signal?: AbortSignal;
}

export interface ImageGenerationResult {
  imageBase64: string;
  contentType: string;
}

export interface ImageProviderAdapter {
  slug: string;
  generateImage(request: ImageGenerationRequest): Promise<ImageGenerationResult>;
}
