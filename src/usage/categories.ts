/**
 * The metered-capability vocabulary, shared by server and client.
 *
 * Deliberately free of `server-only` and of any database import: the
 * admin console's client components need the same category and feature-key
 * lists that the quota engine enforces with, and duplicating them is how
 * an override form ends up offering a key nothing reads.
 *
 * Nothing here is sensitive — these are names, not limits. The limits
 * themselves, and every decision made from them, stay server-side.
 */

export type UsageCategory =
  | "messages"
  | "image_generations"
  | "vision_requests"
  | "file_processing"
  | "audio_processing"
  | "video_processing";

export const USAGE_CATEGORIES: readonly UsageCategory[] = [
  "messages",
  "image_generations",
  "vision_requests",
  "file_processing",
  "audio_processing",
  "video_processing",
] as const;

/** Category -> the plan entitlement key that carries its daily allowance. */
export const DAILY_FEATURE_KEY: Record<UsageCategory, string> = {
  messages: "messages_per_day",
  image_generations: "image_generations_per_day",
  vision_requests: "vision_requests_per_day",
  file_processing: "file_processing_per_day",
  audio_processing: "audio_processing_per_day",
  video_processing: "video_processing_per_day",
};

export function isUsageCategory(value: string): value is UsageCategory {
  return (USAGE_CATEGORIES as readonly string[]).includes(value);
}

/**
 * Feature keys a per-user override may target.
 *
 * Validated server-side before any override is written, so an unknown key
 * is refused rather than stored as a row the quota engine never reads.
 */
export const OVERRIDABLE_FEATURE_KEYS = [
  ...USAGE_CATEGORIES.map((category) => DAILY_FEATURE_KEY[category]),
  "max_file_size_mb",
  "max_attachments_per_message",
  "premium_models",
  "advanced_models",
] as const;

export function isOverridableFeatureKey(key: string): boolean {
  return (OVERRIDABLE_FEATURE_KEYS as readonly string[]).includes(key);
}

/** Entitlement keys whose value is a boolean rather than a numeric limit. */
export const BOOLEAN_FEATURE_KEYS: readonly string[] = ["premium_models", "advanced_models"];
