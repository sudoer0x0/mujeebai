export interface UiMessageVariant {
  id: string;
  sequence: number;
  content: string | null;
  reasoning_summary: string | null;
  finish_reason: string | null;
  error: { code: string; message: string } | null;
  usage?: Record<string, unknown> | null;
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
  savedMemories?: Array<{ id?: string; category: string; content: string }>;
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

/**
 * Which variant a message is currently showing, and its text.
 *
 * Extracted because the renderer and the streaming updater each worked
 * this out for themselves and did not agree. The renderer fell back to
 * the last variant when `activeVariantIndex` was unset; the updater gave
 * up in that case and wrote to `message.content` instead. A fresh variant
 * row is created with `content: ""`, and an empty string is not nullish —
 * so `activeVariant?.content ?? message.content` returned `""` and the
 * reply streamed into a field nothing was rendering. It only appeared
 * after a reload, when the server sent the variant already filled in.
 */
export function activeVariantIndexOf(message: UiMessage): number | null {
  const variants = message.variants ?? [];
  if (variants.length === 0) return null;
  const index = message.activeVariantIndex ?? variants.length - 1;
  return variants[index] ? index : null;
}

/** The text to display for a message, wherever it currently lives. */
export function displayContentOf(message: UiMessage): string {
  if (message.role === "user") return message.content ?? "";
  const index = activeVariantIndexOf(message);
  const fromVariant = index === null ? "" : (message.variants?.[index]?.content ?? "");
  // Truthiness, not nullish: an empty variant means "nothing streamed
  // here yet", and the message's own content is the better answer.
  const raw = fromVariant || message.content || "";
  return raw.replace(/^\s*(?:(?:User|Response)\s+Safety:\s*\w+[\r\n\s]*)+/i, "");
}
