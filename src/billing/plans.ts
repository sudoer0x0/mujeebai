import "server-only";
import { cache } from "react";
import { getUserContext } from "@/auth/user-context";
import { getRegistry } from "@/lib/cached-registry";
import type { Tables } from "@/types/database";

export type PlanRow = Tables<"plans">;
export type SubscriptionRow = Tables<"subscriptions">;

export const listActivePlans = cache(async (): Promise<PlanRow[]> => {
  const { plans } = await getRegistry();
  return plans.filter((plan) => plan.is_active);
});

export async function getDefaultPlan(): Promise<PlanRow | null> {
  const plans = await listActivePlans();
  return plans.find((p) => p.is_default) ?? plans[0] ?? null;
}

/**
 * The user's active subscription plan, or the default plan.
 *
 * Both halves are already in memory by the time this is called: the
 * subscription comes from the shared user-context round trip, and the
 * plan list from the cached global registry. So this costs no database
 * access of its own.
 *
 * A user who cancelled and resubscribed legitimately has several
 * subscription rows; the context loader picks the most recent billable
 * one rather than erroring on the ambiguity.
 */
export const getUserActivePlan = cache(async (userId: string): Promise<PlanRow> => {
  const { subscription } = await getUserContext(userId);
  if (subscription?.plans) return subscription.plans;

  const fallback = await getDefaultPlan();
  if (!fallback) {
    throw new Error("No default plan configured — run the seed migration or configure one in Admin -> Plans.");
  }
  return fallback;
});
