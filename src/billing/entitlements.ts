import "server-only";
import { cache } from "react";
import { getUserContext } from "@/auth/user-context";
import { getUserActivePlan } from "@/billing/plans";
import { getRegistry } from "@/lib/cached-registry";
import type { Json } from "@/types/database";

/**
 * Effective entitlements for a user: plan values overlaid with per-user
 * overrides.
 *
 * ## Why this is one cached fetch and not a query per lookup
 *
 * The previous shape resolved a *single* feature key per call, and each
 * call ran the whole chain: read `user_entitlements`, resolve the active
 * plan (a `subscriptions` join plus the plan list), then read
 * `plan_entitlements`. Every round trip to this project's database costs
 * ~190ms, so a page asking for four quotas paid for roughly a dozen
 * sequential queries — seconds of latency for data that never changes
 * within a request.
 *
 * Now the whole entitlement map is fetched once per user per request and
 * memoised with React's `cache()`. Every `getEffective*` call after the
 * first is a map lookup.
 */

export interface EffectiveEntitlements {
  planId: string;
  planSlug: string;
  values: Record<string, Json>;
}

const loadEntitlements = cache(async (userId: string): Promise<EffectiveEntitlements> => {
  // Neither of these touches the database on its own: the plan resolves
  // from the shared user-context round trip plus the cached registry, and
  // the overrides came back in that same round trip.
  const [plan, { planEntitlements }, { overrides }] = await Promise.all([
    getUserActivePlan(userId),
    getRegistry(),
    getUserContext(userId),
  ]);

  const values: Record<string, Json> = {};
  for (const row of planEntitlements) {
    if (row.plan_id === plan.id) values[row.feature_key] = row.value;
  }

  // Overrides win, unless expired. An expired override is simply ignored
  // rather than deleted — the row is a record of a decision someone made.
  const now = Date.now();
  for (const row of overrides) {
    if (row.expires_at && new Date(row.expires_at).getTime() <= now) continue;
    values[row.feature_key] = row.value;
  }

  return { planId: plan.id, planSlug: plan.slug, values };
});

export async function getEffectiveEntitlements(userId: string): Promise<EffectiveEntitlements> {
  return loadEntitlements(userId);
}

export async function getEffectiveEntitlement(userId: string, featureKey: string): Promise<Json | null> {
  const { values } = await loadEntitlements(userId);
  return values[featureKey] ?? null;
}

export async function getEffectiveNumber(userId: string, featureKey: string, fallback = 0): Promise<number> {
  const value = await getEffectiveEntitlement(userId, featureKey);
  if (value === null || value === undefined) return fallback;
  const numeric = typeof value === "number" ? value : Number(value);
  return Number.isFinite(numeric) ? numeric : fallback;
}

export async function getEffectiveBoolean(userId: string, featureKey: string, fallback = false): Promise<boolean> {
  const value = await getEffectiveEntitlement(userId, featureKey);
  if (typeof value === "boolean") return value;
  if (value === null || value === undefined) return fallback;
  return Boolean(value);
}
