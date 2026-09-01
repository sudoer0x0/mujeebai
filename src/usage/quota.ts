import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { getEffectiveNumber } from "@/billing/entitlements";
import { GatewayError } from "@/ai/types";
import { DAILY_FEATURE_KEY, type UsageCategory } from "@/usage/categories";

// Capability-based usage tracking and quota enforcement.
//
// The category vocabulary lives in `@/usage/categories`, which carries no
// `server-only` marker so the admin console's client components can share
// exactly the keys this engine enforces against.
export {
  USAGE_CATEGORIES,
  DAILY_FEATURE_KEY,
  isUsageCategory,
  type UsageCategory,
} from "@/usage/categories";

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10); // YYYY-MM-DD (UTC)
}

export interface QuotaStatus {
  allowed: boolean;
  limit: number;
  used: number;
  remaining: number;
}

/** Read-only check — does not consume any usage. */
export async function checkQuota(userId: string, category: UsageCategory): Promise<QuotaStatus> {
  const limit = await getEffectiveNumber(userId, DAILY_FEATURE_KEY[category], 0);

  // A limit of -1 is the convention for "unlimited" (e.g. a future
  // Enterprise plan) — see ARCHITECTURE.md#Usage.
  if (limit < 0) {
    return { allowed: true, limit: -1, used: 0, remaining: Infinity };
  }

  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("usage_counters")
    .select("count")
    .eq("user_id", userId)
    .eq("category", category)
    .eq("period", "day")
    .eq("period_key", todayKey())
    .maybeSingle();

  const used = data?.count ?? 0;
  return { allowed: used < limit, limit, used, remaining: Math.max(0, limit - used) };
}

/**
 * Checks quota and, if allowed, atomically records `quantity` units of
 * usage. Throws a GatewayError('quota_exceeded', ...) if the user is over
 * their effective limit — callers should catch this and surface the
 * translated `chat.quotaReached.*` copy rather than a raw error.
 *
 * This calls `try_consume_usage` (0006_security_hardening.sql), which does
 * the "is this under the limit" check and the increment as one atomic
 * database statement. An earlier version of this function called a plain
 * read (checkQuota) and only *then* incremented — that has a real
 * check-then-write race under concurrent requests from the same user
 * (several requests can all pass the read-based check before any of them
 * writes), which would let a user exceed their daily limit. Callers that
 * want a *cheap, non-consuming* pre-check (e.g. to bail out early before
 * doing other work) should still use `checkQuota` for that — just don't
 * treat it as the actual gate the way this function is.
 */
export async function consumeQuota(userId: string, category: UsageCategory, quantity = 1): Promise<QuotaStatus> {
  const limit = await getEffectiveNumber(userId, DAILY_FEATURE_KEY[category], 0);
  const supabase = createServiceRoleClient();

  const { data, error } = await supabase.rpc("try_consume_usage", {
    p_user_id: userId,
    p_category: category,
    p_period: "day",
    p_period_key: todayKey(),
    p_quantity: quantity,
    p_limit: limit,
  });

  if (error) {
    throw new GatewayError("unknown", `Failed to record usage: ${error.message}`);
  }

  const row = Array.isArray(data) ? data[0] : data;
  const used = row?.new_count ?? 0;

  if (!row?.allowed) {
    throw new GatewayError("quota_exceeded", `Daily limit reached for ${category}.`);
  }

  return {
    allowed: true,
    limit,
    used,
    remaining: limit < 0 ? Infinity : Math.max(0, limit - used),
  };
}
