import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { USAGE_CATEGORIES, type UsageCategory } from "@/usage/categories";

/**
 * Administrative usage and quota operations.
 *
 * All of these run server-side through the service role after the caller
 * has passed the permission matrix. There is deliberately no client-
 * reachable route that resets or raises a quota: a limit a browser can
 * change is not a limit.
 *
 * Limits themselves are never edited here. The effective limit is
 * `plan_entitlements` overlaid with a per-user `user_entitlements` row
 * (#125), so "give this user more messages" writes an override with an
 * audit trail and an optional expiry, rather than mutating the plan
 * everyone else is on.
 */

function todayKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export interface UsageTotals {
  category: string;
  total: number;
  users: number;
}

/** Platform-wide totals for a given day. */
export async function getUsageTotals(periodKey = todayKey()): Promise<UsageTotals[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("usage_counters")
    .select("category, count, user_id")
    .eq("period", "day")
    .eq("period_key", periodKey);

  const totals = new Map<string, { total: number; users: Set<string> }>();
  for (const row of data ?? []) {
    const entry = totals.get(row.category) ?? { total: 0, users: new Set<string>() };
    entry.total += row.count;
    entry.users.add(row.user_id);
    totals.set(row.category, entry);
  }

  // Always return every known category, including the ones with no usage
  // — a missing tile reads as "not tracked", which is a different and
  // wrong message from "nobody used this today".
  return USAGE_CATEGORIES.map((category) => ({
    category,
    total: totals.get(category)?.total ?? 0,
    users: totals.get(category)?.users.size ?? 0,
  }));
}

export interface TopConsumer {
  userId: string;
  email: string | null;
  displayName: string | null;
  total: number;
}

/** The heaviest consumers for a category on a given day. */
export async function getTopConsumers(
  category: UsageCategory,
  periodKey = todayKey(),
  limit = 10,
): Promise<TopConsumer[]> {
  const supabase = createServiceRoleClient();
  const { data } = await supabase
    .from("usage_counters")
    .select("user_id, count, profiles(email, display_name)")
    .eq("period", "day")
    .eq("period_key", periodKey)
    .eq("category", category)
    .order("count", { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => {
    const profile = row.profiles as unknown as { email: string | null; display_name: string | null } | null;
    return {
      userId: row.user_id,
      email: profile?.email ?? null,
      displayName: profile?.display_name ?? null,
      total: row.count,
    };
  });
}

/**
 * Resets today's counters for one user.
 *
 * Sets the count to zero rather than deleting the row, so the row's
 * `updated_at` still records that a reset happened at all. Returns how
 * many counters were affected so the caller can report something
 * concrete instead of an unconditional "done".
 */
export async function resetUsageForUser(
  userId: string,
  category?: UsageCategory,
  periodKey = todayKey(),
): Promise<number> {
  const supabase = createServiceRoleClient();
  const base = supabase
    .from("usage_counters")
    .update({ count: 0, updated_at: new Date().toISOString() })
    .eq("user_id", userId)
    .eq("period", "day")
    .eq("period_key", periodKey)
    .gt("count", 0);

  const { data } = await (category ? base.eq("category", category) : base).select("id");
  return data?.length ?? 0;
}

export interface OverrideInput {
  userId: string;
  featureKey: string;
  /** Numeric limit, or a boolean for access-style features. -1 means unlimited. */
  value: number | boolean;
  reason?: string;
  grantedBy: string;
  expiresAt?: string | null;
}

/**
 * Grants or updates a per-user entitlement override.
 *
 * Upserts on (user_id, feature_key) so repeatedly raising the same
 * user's limit updates one row rather than accumulating a pile of
 * conflicting grants whose precedence nobody can reason about.
 */
export async function setUserOverride(input: OverrideInput): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase.from("user_entitlements").upsert(
    {
      user_id: input.userId,
      feature_key: input.featureKey,
      value: input.value,
      reason: input.reason ?? null,
      granted_by: input.grantedBy,
      expires_at: input.expiresAt ?? null,
    },
    { onConflict: "user_id,feature_key" },
  );

  if (error) throw new Error(`Failed to set entitlement override: ${error.message}`);
}

export async function removeUserOverride(userId: string, featureKey: string): Promise<void> {
  const supabase = createServiceRoleClient();
  const { error } = await supabase
    .from("user_entitlements")
    .delete()
    .eq("user_id", userId)
    .eq("feature_key", featureKey);

  if (error) throw new Error(`Failed to remove entitlement override: ${error.message}`);
}
