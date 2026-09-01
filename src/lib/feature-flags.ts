import "server-only";
import { cache } from "react";
import { getRegistry } from "@/lib/cached-registry";

/**
 * Feature flags, served from the cached registry snapshot.
 *
 * These are read on nearly every request (the composer alone checks two),
 * and they change only when an administrator toggles one — so a
 * per-request database read was pure overhead.
 */
export const isFeatureEnabled = cache(async (key: string): Promise<boolean> => {
  const { featureFlags } = await getRegistry();
  return featureFlags[key] ?? false;
});

export const getAllFeatureFlags = cache(async (): Promise<Record<string, boolean>> => {
  const { featureFlags } = await getRegistry();
  return featureFlags;
});
