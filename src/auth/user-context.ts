import "server-only";
import { cache } from "react";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { Tables } from "@/types/database";

/**
 * Everything user-scoped that a request needs, in **one** database round
 * trip.
 *
 * ## Why this exists
 *
 * Rendering an authenticated page used to make three separate PostgREST
 * requests that always happened together:
 *
 *   1. `profiles`          — who the user is, their role and status
 *   2. `subscriptions`     — which plan they are on
 *   3. `user_entitlements` — their per-user overrides
 *
 * Each one is a full HTTPS round trip, and the measured round-trip time to
 * this project's region is ~156ms (min 141, max 181). Three sequential
 * trips is therefore ~500ms of pure waiting before any rendering starts —
 * and it was sequential, because the plan lookup had to finish before the
 * entitlement lookup could begin.
 *
 * PostgREST can embed related rows through a foreign key, and
 * `subscriptions.user_id`, `user_entitlements.user_id` and `profiles.id`
 * all point at `profiles`. So all three come back from a single request.
 *
 * `cache()` scopes the result to one request: the layout, the chat
 * capabilities loader, the quota checks and every entitlement lookup share
 * it rather than each paying for their own.
 */

export type Profile = Tables<"profiles">;
export type SubscriptionRow = Tables<"subscriptions">;
export type PlanRow = Tables<"plans">;

export interface EntitlementOverride {
  feature_key: string;
  value: Tables<"user_entitlements">["value"];
  expires_at: string | null;
}

export interface UserContext {
  profile: Profile | null;
  /** Most recent subscription in a billable state, with its plan embedded. */
  subscription: (SubscriptionRow & { plans: PlanRow | null }) | null;
  overrides: EntitlementOverride[];
}

const EMPTY: UserContext = { profile: null, subscription: null, overrides: [] };

export const getUserContext = cache(async (userId: string): Promise<UserContext> => {
  const supabase = await createServerSupabaseClient();

  // `user_entitlements` has *two* foreign keys to `profiles` — `user_id`
  // and `granted_by` — so the embed must name the constraint. Left
  // ambiguous, PostgREST refuses the whole request with PGRST201 and the
  // page silently loses its entitlements.
  const { data, error } = await supabase
    .from("profiles")
    .select(
      "*, " +
        "subscriptions!subscriptions_user_id_fkey(*, plans(*)), " +
        "user_entitlements!user_entitlements_user_id_fkey(feature_key, value, expires_at)",
    )
    .eq("id", userId)
    .maybeSingle();

  if (error || !data) return EMPTY;

  const { subscriptions, user_entitlements, ...profile } = data as unknown as Profile & {
    subscriptions: (SubscriptionRow & { plans: PlanRow | null })[] | null;
    user_entitlements: EntitlementOverride[] | null;
  };

  // Filtering in JS rather than in the embed: the row set per user is
  // tiny, and a `.or()`/embedded filter here would cost readability for no
  // measurable gain over a request that is already a single round trip.
  const billable = (subscriptions ?? [])
    .filter((row) => ["active", "trialing", "past_due"].includes(row.status))
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));

  return {
    profile: profile as Profile,
    subscription: billable[0] ?? null,
    overrides: user_entitlements ?? [],
  };
});
