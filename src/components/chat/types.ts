export interface UiMessageVariant {
  id: string;
  sequence: number;
  content: string | null;
  reasoning_summary: string | null;
  finish_reason: string | null;
  error: { code: string; message: string } | null;
}

/**
 * An upload shown alongside a message.
 *
 * `id` doubles as the fetch path (`/api/attachments/<id>`), which re-signs
 * the private storage URL on demand — attachments must never carry a
 * baked-in signed URL, because those expire.
 */
export interface UiAttachment {
  id: string;
  filename: string;
  kind: string;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system";
  status: "pending" | "streaming" | "complete" | "error" | "stopped";
  content: string | null;
  variants?: UiMessageVariant[];
  activeVariantIndex?: number;
  /** Files sent with this message. Rendered under the bubble. */
  attachments?: UiAttachment[];
  reasoning?: string | null;
}

export interface ModelOption {
  slug: string;
  displayName: string;
  description: string | null;
  capabilities: string[];
  tier: "free" | "pro" | "premium" | "experimental";
  availability: string;
  unlocked: boolean;
}
