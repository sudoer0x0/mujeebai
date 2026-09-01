/**
 * Public (browser-safe) configuration.
 *
 * This module must stay importable from Client Components, so it reads
 * only `NEXT_PUBLIC_*` variables and references each one as an explicit
 * `process.env.NEXT_PUBLIC_X` member expression — that is the form Next
 * statically replaces at build time, and it is what makes these values
 * available in the browser bundle at all.
 *
 * Server-only secrets live in `@/lib/env.server`, which carries
 * `import "server-only"` so importing it from a Client Component is a
 * build error rather than a leak discovered in production. This file used
 * to export both, and handed the entire `process.env` object to a schema
 * that listed every secret by name — it did not leak (Next only inlines
 * literal member accesses), but nothing about it was structurally safe.
 */
import { z } from "zod";

const clientSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.string().url(),
  NEXT_PUBLIC_SUPABASE_ANON_KEY: z.string().min(1),
  NEXT_PUBLIC_SITE_URL: z.string().url().default("http://localhost:3000"),
  NEXT_PUBLIC_APP_NAME: z.string().default("Mujeeb AI"),
});

function readClientEnv() {
  const raw = {
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    NEXT_PUBLIC_SITE_URL: process.env.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_NAME: process.env.NEXT_PUBLIC_APP_NAME,
  };

  const parsed = clientSchema.safeParse(raw);
  if (parsed.success) return parsed.data;

  // Don't throw during build or type-check when placeholders are absent:
  // the marketing pages must still render, and anything that actually
  // needs Supabase fails loudly at request time with a clearer message
  // than a crashed build.
  if (typeof window === "undefined") {
    console.warn("[env] Missing/invalid public environment variables:", parsed.error.flatten().fieldErrors);
  }

  return clientSchema.parse({
    NEXT_PUBLIC_SUPABASE_URL: raw.NEXT_PUBLIC_SUPABASE_URL || "http://localhost:54321",
    NEXT_PUBLIC_SUPABASE_ANON_KEY: raw.NEXT_PUBLIC_SUPABASE_ANON_KEY || "placeholder-anon-key",
    NEXT_PUBLIC_SITE_URL: raw.NEXT_PUBLIC_SITE_URL,
    NEXT_PUBLIC_APP_NAME: raw.NEXT_PUBLIC_APP_NAME,
  });
}

export const clientEnv = readClientEnv();

export const isProduction = process.env.NODE_ENV === "production";
