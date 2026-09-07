import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { Role } from "@/admin/permissions";
import type { Tables } from "@/types/database";

export type AccountStatus = Tables<"profiles">["status"];

/**
 * Read helpers for the staff portals.
 *
 * These run through the service-role client because a moderator's own RLS
 * grant deliberately does not extend to every user's rows — the
 * authorization decision is made in the server action that calls these,
 * against the permission matrix, not by RLS. Nothing here is reachable
 * without having already passed `requireStaff()` / `assertPermission`.
 */

export interface StaffUserRow {
  id: string;
  email: string | null;
  displayName: string | null;
  role: Role;
  status: string;
  locale: string;
  createdAt: string;
}

export interface UserListResult {
  users: StaffUserRow[];
  total: number;
  page: number;
  pageSize: number;
}

export interface UserListFilters {
  query?: string;
  role?: Role | "all";
  status?: AccountStatus | "all";
  page?: number;
  pageSize?: number;
}

export async function listUsers(filters: UserListFilters = {}): Promise<UserListResult> {
  const supabase = createServiceRoleClient();
  const pageSize = Math.min(Math.max(filters.pageSize ?? 25, 1), 100);
  const page = Math.max(filters.page ?? 1, 1);
  const from = (page - 1) * pageSize;

  let query = supabase
    .from("profiles")
    .select("id, email, display_name, role, status, locale, created_at", { count: "exact" })
    .order("created_at", { ascending: false })
    .range(from, from + pageSize - 1);

  if (filters.query) {
    // Escape the LIKE wildcards a user could type, so searching for "%"
    // does not turn into "match everything" and "_" stays a literal.
    const term = filters.query.replace(/[%_\\]/g, (char) => `\\${char}`);
    query = query.or(`email.ilike.%${term}%,display_name.ilike.%${term}%`);
  }
  if (filters.role && filters.role !== "all") query = query.eq("role", filters.role);
  if (filters.status && filters.status !== "all") query = query.eq("status", filters.status);

  const { data, count } = await query;

  return {
    users: (data ?? []).map((row) => ({
      id: row.id,
      email: row.email,
      displayName: row.display_name,
      role: row.role as Role,
      status: row.status,
      locale: row.locale,
      createdAt: row.created_at,
    })),
    total: count ?? 0,
    page,
    pageSize,
  };
}

/** Loads the target of a privileged action, for `assertCanActOn`. */
export type UserStatus = "active" | "suspended" | "disabled" | "pending_verification" | "deleted";

export async function getUserForAction(
  userId: string,
): Promise<{ id: string; role: Role; email: string | null; status: UserStatus } | null> {
  const supabase = createServiceRoleClient();
  // `status` is included so a moderation action can record what it
  // replaced, which is what makes the action undoable.
  const { data } = await supabase
    .from("profiles")
    .select("id, role, email, status")
    .eq("id", userId)
    .maybeSingle();
  if (!data) return null;
  return { id: data.id, role: data.role as Role, email: data.email, status: data.status as UserStatus };
}

import { getUserPastUsage, type UserPastUsageHistory } from "@/usage/admin";

export interface UserDetail extends StaffUserRow {
  planName: string | null;
  planSlug: string | null;
  subscriptionStatus: string | null;
  currentPeriodEnd: string | null;
  /**
   * True when the active subscription is a complimentary grant rather
   * than a paid one. The revoke control keys off this: ending a *paid*
   * subscription from the console would cancel someone's billing behind
   * their back, so the action refuses it server-side and the UI does not
   * offer it.
   */
  isGrant: boolean;
  conversationCount: number;
  usageToday: Array<{ category: string; count: number }>;
  pastUsage: UserPastUsageHistory;
  overrides: Array<{ featureKey: string; value: unknown; expiresAt: string | null; reason: string | null }>;
}

function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Everything the staff detail view needs, in one pass.
 *
 * Issued as parallel queries rather than sequentially: they are
 * independent, and awaiting each in turn made the detail page as slow as
 * the sum of five round trips.
 */
export async function getUserDetail(userId: string): Promise<UserDetail | null> {
  const supabase = createServiceRoleClient();

  const [profileResult, subscriptionResult, conversationResult, usageResult, overrideResult, pastUsage] = await Promise.all([
    supabase.from("profiles").select("id, email, display_name, role, status, locale, created_at").eq("id", userId).maybeSingle(),
    supabase
      .from("subscriptions")
      .select("status, current_period_end, billing_provider, plans(name, slug)")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1),
    supabase.from("conversations").select("id", { count: "exact", head: true }).eq("user_id", userId),
    supabase
      .from("usage_counters")
      .select("category, count")
      .eq("user_id", userId)
      .eq("period", "day")
      .eq("period_key", todayKey()),
    supabase.from("user_entitlements").select("feature_key, value, expires_at, reason").eq("user_id", userId),
    getUserPastUsage(userId, 30),
  ]);

  const profile = profileResult.data;
  if (!profile) return null;

  const subscription = subscriptionResult.data?.[0] as
    | {
        status: string;
        current_period_end: string | null;
        billing_provider: string | null;
        plans: { name: string; slug: string } | null;
      }
    | undefined;

  return {
    id: profile.id,
    email: profile.email,
    displayName: profile.display_name,
    role: profile.role as Role,
    status: profile.status,
    locale: profile.locale,
    createdAt: profile.created_at,
    planName: subscription?.plans?.name ?? null,
    planSlug: subscription?.plans?.slug ?? null,
    subscriptionStatus: subscription?.status ?? null,
    currentPeriodEnd: subscription?.current_period_end ?? null,
    isGrant: subscription?.billing_provider === "manual",
    conversationCount: conversationResult.count ?? 0,
    usageToday: (usageResult.data ?? []).map((row) => ({ category: row.category, count: row.count })),
    pastUsage,
    overrides: (overrideResult.data ?? []).map((row) => ({
      featureKey: row.feature_key,
      value: row.value,
      expiresAt: row.expires_at,
      reason: row.reason,
    })),
  };
}
