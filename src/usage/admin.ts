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

export interface DailyPlatformUsage {
  date: string;
  activeUsers: number;
  totalUsage: number;
  byCategory: Record<string, number>;
}

export interface PlatformUsageHistoryResult {
  days: DailyPlatformUsage[];
  totalsSummary: {
    totalActions: number;
    activeUsers7d: number;
    activeUsers30d: number;
    totalMessages: number;
    totalImages: number;
  };
}

/** Platform-wide daily usage history over the last N days (default 30). */
export async function getPlatformUsageHistory(daysCount = 30): Promise<PlatformUsageHistoryResult> {
  const supabase = createServiceRoleClient();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (daysCount - 1));
  const startKey = startDate.toISOString().slice(0, 10);

  const { data } = await supabase
    .from("usage_counters")
    .select("category, count, user_id, period_key")
    .eq("period", "day")
    .gte("period_key", startKey)
    .order("period_key", { ascending: false });

  const dateMap = new Map<string, { activeUsers: Set<string>; totalUsage: number; byCategory: Record<string, number> }>();
  const allUsers30d = new Set<string>();
  const allUsers7d = new Set<string>();
  const sevenDaysAgoKey = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  let totalActions = 0;
  let totalMessages = 0;
  let totalImages = 0;

  for (const row of data ?? []) {
    totalActions += row.count;
    if (row.category === "messages") totalMessages += row.count;
    if (row.category === "image_generations") totalImages += row.count;
    allUsers30d.add(row.user_id);
    if (row.period_key >= sevenDaysAgoKey) {
      allUsers7d.add(row.user_id);
    }

    let entry = dateMap.get(row.period_key);
    if (!entry) {
      entry = { activeUsers: new Set(), totalUsage: 0, byCategory: {} };
      dateMap.set(row.period_key, entry);
    }
    entry.activeUsers.add(row.user_id);
    entry.totalUsage += row.count;
    entry.byCategory[row.category] = (entry.byCategory[row.category] ?? 0) + row.count;
  }

  // Generate continuous list of dates for the window so days with 0 usage still show
  const days: DailyPlatformUsage[] = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = dateMap.get(key);
    days.push({
      date: key,
      activeUsers: entry ? entry.activeUsers.size : 0,
      totalUsage: entry ? entry.totalUsage : 0,
      byCategory: entry ? entry.byCategory : {},
    });
  }

  return {
    days,
    totalsSummary: {
      totalActions,
      activeUsers7d: allUsers7d.size,
      activeUsers30d: allUsers30d.size,
      totalMessages,
      totalImages,
    },
  };
}

export interface UserDailyUsageEntry {
  date: string;
  totalUsage: number;
  byCategory: Record<string, number>;
}

export interface UserUsageEventEntry {
  id: string;
  category: string;
  quantity: number;
  createdAt: string;
}

export interface UserPastUsageHistory {
  days: UserDailyUsageEntry[];
  recentEvents: UserUsageEventEntry[];
  totalsSummary: {
    totalActions30d: number;
    totalMessages30d: number;
  };
}

/** Past usage history and recent usage events for an individual user. */
export async function getUserPastUsage(userId: string, daysCount = 30): Promise<UserPastUsageHistory> {
  const supabase = createServiceRoleClient();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - (daysCount - 1));
  const startKey = startDate.toISOString().slice(0, 10);

  const [countersResult, eventsResult] = await Promise.all([
    supabase
      .from("usage_counters")
      .select("category, count, period_key")
      .eq("user_id", userId)
      .eq("period", "day")
      .gte("period_key", startKey)
      .order("period_key", { ascending: false }),
    supabase
      .from("usage_events")
      .select("id, category, quantity, created_at")
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .limit(50),
  ]);

  const dateMap = new Map<string, { totalUsage: number; byCategory: Record<string, number> }>();
  let totalActions30d = 0;
  let totalMessages30d = 0;

  for (const row of countersResult.data ?? []) {
    totalActions30d += row.count;
    if (row.category === "messages") totalMessages30d += row.count;

    let entry = dateMap.get(row.period_key);
    if (!entry) {
      entry = { totalUsage: 0, byCategory: {} };
      dateMap.set(row.period_key, entry);
    }
    entry.totalUsage += row.count;
    entry.byCategory[row.category] = (entry.byCategory[row.category] ?? 0) + row.count;
  }

  const days: UserDailyUsageEntry[] = [];
  for (let i = 0; i < daysCount; i++) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    const entry = dateMap.get(key);
    if (entry && entry.totalUsage > 0) {
      days.push({
        date: key,
        totalUsage: entry.totalUsage,
        byCategory: entry.byCategory,
      });
    }
  }

  const recentEvents: UserUsageEventEntry[] = (eventsResult.data ?? []).map((e) => ({
    id: e.id,
    category: e.category,
    quantity: e.quantity,
    createdAt: e.created_at,
  }));

  return {
    days,
    recentEvents,
    totalsSummary: {
      totalActions30d,
      totalMessages30d,
    },
  };
}
