import "server-only";
import { createSupabaseStorageAdapter } from "@/storage/supabase-storage";
import type { StorageAdapter } from "@/storage/types";

// Storage adapter factory.
export function createStorageAdapter(): StorageAdapter {
  const provider = process.env.STORAGE_PROVIDER ?? "supabase";

  switch (provider) {
    case "supabase":
      return createSupabaseStorageAdapter();
    default:
      throw new Error(
        `Unknown STORAGE_PROVIDER '${provider}'. Implement an adapter and register it in src/storage/factory.ts.`,
      );
  }
}
