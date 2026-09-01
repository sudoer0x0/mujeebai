import "server-only";
import { unstable_cache } from "next/cache";
import { createClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";
import type { Database, Tables } from "@/types/database";

/**
 * Cross-request cache for the platform's global configuration.
 *
 * Models, providers, plans, entitlements, feature flags and system
 * settings are the same for every visitor and change only when an
 * administrator edits them — yet they were re-read from the database on
 * essentially every request. Each round trip to this project costs ~190ms,
 * so a single page load was spending most of its time re-fetching data
 * that had not changed in days.
 *
 * Two things make this safe:
 *
 * 1. **No user data passes through here.** Everything cached is
 *    world-readable configuration that the RLS policies already expose to
 *    anonymous callers. Nothing user-scoped is cached across requests.
 * 2. **A dedicated cookie-less client.** `unstable_cache` forbids reading
 *    cookies inside the cached function, and using the request's session
 *    client would risk caching one user's view for everyone. This client
 *    carries the anon key and no session at all.
 *
 * Admin writes call `revalidateRegistry()`, so an edit is visible
 * immediately rather than after the TTL.
 */

const REGISTRY_TAG = "mujeeb:registry";

/** Anonymous, session-free client. Safe to use inside a cached function. */
function publicClient() {
  return createClient<Database>(clientEnv.NEXT_PUBLIC_SUPABASE_URL, clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}

export interface RegistrySnapshot {
  models: Tables<"models">[];
  providers: Tables<"providers">[];
  plans: Tables<"plans">[];
  planEntitlements: Array<{ plan_id: string; feature_key: string; value: Tables<"plan_entitlements">["value"] }>;
  featureFlags: Record<string, boolean>;
  settings: Record<string, Tables<"system_settings">["value"]>;
}

/**
 * Loads the whole snapshot in one parallel batch.
 *
 * Six queries issued together cost about one round trip in wall-clock
 * terms, and only on a cache miss.
 */
async function loadRegistry(): Promise<RegistrySnapshot> {
  const supabase = publicClient();

  const [models, providers, plans, planEntitlements, flags, settings] = await Promise.all([
    supabase.from("models").select("*").order("priority", { ascending: false }),
    supabase.from("providers").select("*"),
    supabase.from("plans").select("*").order("sort_order", { ascending: true }),
    supabase.from("plan_entitlements").select("plan_id, feature_key, value"),
    supabase.from("feature_flags").select("key, enabled"),
    supabase.from("system_settings").select("key, value"),
  ]);

  return {
    models: models.data ?? [],
    providers: providers.data ?? [],
    plans: plans.data ?? [],
    planEntitlements: planEntitlements.data ?? [],
    featureFlags: Object.fromEntries((flags.data ?? []).map((row) => [row.key, row.enabled])),
    settings: Object.fromEntries((settings.data ?? []).map((row) => [row.key, row.value])),
  };
}

export const getRegistry = unstable_cache(loadRegistry, ["mujeeb-registry"], {
  tags: [REGISTRY_TAG],
  // A ceiling, not the primary mechanism — admin writes revalidate the
  // tag explicitly. This just bounds staleness if a write path is ever
  // added without one.
  revalidate: 60,
});

/**
 * Drops the cached snapshot. Call from every admin action that edits
 * models, providers, plans, entitlements, flags or settings.
 */
export async function revalidateRegistry(): Promise<void> {
  const { revalidateTag } = await import("next/cache");
  revalidateTag(REGISTRY_TAG);
}
