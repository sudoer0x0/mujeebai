import "server-only";
import { cache } from "react";
import { getRegistry } from "@/lib/cached-registry";
import { minorUnitFactor } from "@/billing/currencies";
import type { PlanRow } from "@/billing/plans";
import type { Json } from "@/types/database";

/**
 * The single source of truth for what a plan costs and what it includes.
 *
 * Everything user-facing about pricing — the marketing page, the settings
 * card, the admin plan editor, the Paystack checkout amount — resolves
 * through here, and here resolves to the `plans` / `plan_entitlements`
 * rows. Nothing renders a price it computed or typed itself.
 *
 * This exists because the pricing page used to fetch the plans and then
 * throw the result away, rendering a hardcoded "$20" next to a database
 * that said 10.00 and a checkout that charged 10.00. A hardcoded "$10"
 * would have been the same bug with a friendlier number.
 */

/** Feature keys that carry a numeric daily allowance. */
export const QUOTA_FEATURE_KEYS = [
  "messages_per_day",
  "image_generations_per_day",
  "vision_requests_per_day",
  "file_processing_per_day",
  "max_file_size_mb",
] as const;

/** Feature keys that gate access to something rather than metering it. */
export const ACCESS_FEATURE_KEYS = ["premium_models", "advanced_models"] as const;

export type QuotaFeatureKey = (typeof QUOTA_FEATURE_KEYS)[number];
export type AccessFeatureKey = (typeof ACCESS_FEATURE_KEYS)[number];
export type FeatureKey = QuotaFeatureKey | AccessFeatureKey;

export interface PlanEntitlement {
  featureKey: string;
  value: Json;
}

export interface ResolvedPlan {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  priceUsd: number;
  currencyPrices: Record<string, number>;
  billingInterval: "month" | "year";
  isDefault: boolean;
  isActive: boolean;
  sortOrder: number;
  /** Feature key -> raw entitlement value, straight from the database. */
  entitlements: Record<string, Json>;
}

function toResolvedPlan(plan: PlanRow, entitlements: PlanEntitlement[]): ResolvedPlan {
  return {
    id: plan.id,
    slug: plan.slug,
    name: plan.name,
    description: plan.description,
    priceUsd: Number(plan.price_usd),
    currencyPrices: (plan.currency_prices ?? {}) as Record<string, number>,
    billingInterval: plan.billing_interval as "month" | "year",
    isDefault: plan.is_default,
    isActive: plan.is_active,
    sortOrder: plan.sort_order,
    entitlements: Object.fromEntries(entitlements.map((e) => [e.featureKey, e.value])),
  };
}

/**
 * Loads every active plan with its entitlements in two queries.
 *
 * Deliberately not one query per plan: the pricing page renders every
 * plan, and a per-plan entitlement fetch is the classic N+1 that turns a
 * two-plan page into a four-round-trip one the moment a third plan is
 * added from the admin console.
 */
export const listPlansWithEntitlements = cache(async (): Promise<ResolvedPlan[]> => {
  // Both halves come from the cached registry snapshot, so the pricing
  // page costs no database round trips at all on a warm cache.
  const { plans, planEntitlements } = await getRegistry();
  const active = plans.filter((plan) => plan.is_active);

  const byPlan = new Map<string, PlanEntitlement[]>();
  for (const row of planEntitlements) {
    const list = byPlan.get(row.plan_id) ?? [];
    list.push({ featureKey: row.feature_key, value: row.value });
    byPlan.set(row.plan_id, list);
  }

  return active.map((plan) => toResolvedPlan(plan, byPlan.get(plan.id) ?? []));
});



/**
 * Resolves the amount to charge, in the currency's minor unit.
 *
 * Used by both the checkout route and the price the UI shows, so the two
 * can never disagree.
 *
 * Returns `null` when the plan has no price configured in that currency.
 * It used to fall back to `priceUsd`, which meant a plan priced at $5 with
 * no NGN figure rendered as "₦5" on the pricing page — the USD *number*
 * wearing a Naira symbol, roughly a 3000x understatement — while checkout
 * refused the same purchase. Display and billing now agree: if there is no
 * price in this currency, there is no price to show.
 *
 * A free plan (0) is a configured price, not a missing one, so it is
 * returned normally.
 */
export function resolveAmount(
  plan: ResolvedPlan,
  currency: string,
): { major: number; minor: number; currency: string } | null {
  const code = currency.toUpperCase();
  const major = code === "USD" ? plan.priceUsd : plan.currencyPrices[code];

  if (major === undefined || major === null || !Number.isFinite(major) || major < 0) return null;

  // XOF has no subunit — see minorUnitFactor.
  return { major, minor: Math.round(major * minorUnitFactor(code)), currency: code };
}

/**
 * Formats a plan price for display in the viewer's locale.
 *
 * `Intl.NumberFormat` picks the right symbol, placement, grouping and
 * decimal convention per locale — hardcoding "$" in front of a number
 * gets Arabic and Japanese wrong.
 */
export function formatPrice(amount: number, currency: string, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency: currency.toUpperCase(),
    // Whole prices read better without ".00"; fractional ones still show.
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

/** Reads a numeric entitlement, treating a negative value as unlimited. */
export function quotaOf(plan: ResolvedPlan, key: FeatureKey): number | "unlimited" | null {
  const raw = plan.entitlements[key];
  if (raw === undefined || raw === null) return null;
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(value)) return null;
  return value < 0 ? "unlimited" : value;
}

export function hasFeature(plan: ResolvedPlan, key: FeatureKey): boolean {
  const raw = plan.entitlements[key];
  if (typeof raw === "boolean") return raw;
  return Boolean(raw);
}
