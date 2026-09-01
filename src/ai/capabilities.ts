import "server-only";
import { getAllFeatureFlags } from "@/lib/feature-flags";
import { getEffectiveNumber } from "@/billing/entitlements";
import { getCurrentUser } from "@/auth/session";

export interface ChatCapabilities {
  imageGenerationEnabled: boolean;
  fileUploadsEnabled: boolean;
  maxFileSizeMb: number;
  /** Files allowed on one message. Entitlement-driven; see migration 0017. */
  maxAttachments: number;
}

/**
 * What this user may actually do in the composer, resolved server-side.
 *
 * The composer used to always show "Generate image" and the attach
 * button regardless of feature flags or plan, so a free user on a
 * deployment with image generation disabled could press a button that
 * could only ever return an error. Capabilities are computed here and
 * passed down, so the UI offers exactly what the server will accept.
 *
 * This is a UX affordance, not a security control — every one of these is
 * independently re-checked in the corresponding route handler.
 */
export async function loadChatCapabilities(): Promise<ChatCapabilities> {
  const user = await getCurrentUser();

  // Independent of each other; sequential awaits here were two round
  // trips on the critical path of every chat page load.
  const [flags, maxFileSizeMb, maxAttachments] = await Promise.all([
    getAllFeatureFlags(),
    user ? getEffectiveNumber(user.id, "max_file_size_mb", 10) : Promise.resolve(10),
    user ? getEffectiveNumber(user.id, "max_attachments_per_message", 5) : Promise.resolve(5),
  ]);

  return {
    imageGenerationEnabled: flags.image_generation ?? false,
    fileUploadsEnabled: flags.file_uploads ?? false,
    maxFileSizeMb,
    // Never zero: a misconfigured entitlement should not silently disable
    // attachments for everyone on the plan.
    maxAttachments: Math.max(1, Math.min(20, Math.round(maxAttachments) || 5)),
  };
}
