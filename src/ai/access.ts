import "server-only";
import { getEffectiveBoolean } from "@/billing/entitlements";
import type { ModelRow } from "@/ai/registry";

// Verifies user tier entitlement for a requested model.
export async function checkModelAccess(
  userId: string,
  model: ModelRow,
): Promise<{ errorKey: string; status: number } | null> {
  if (["disabled", "maintenance", "deprecated"].includes(model.availability)) {
    return { errorKey: "models.selector.lockedComingSoon", status: 409 };
  }
  if (model.availability === "locked") {
    return { errorKey: "models.selector.lockedComingSoon", status: 403 };
  }
  if (model.tier === "pro" || model.tier === "experimental") {
    const hasPremium = await getEffectiveBoolean(userId, "premium_models", false);
    if (!hasPremium) return { errorKey: "models.selector.lockedPro", status: 403 };
  }
  if (model.tier === "premium") {
    const hasAdvanced = await getEffectiveBoolean(userId, "advanced_models", false);
    if (!hasAdvanced) return { errorKey: "models.selector.lockedPro", status: 403 };
  }
  return null;
}
