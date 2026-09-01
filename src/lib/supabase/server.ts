import { cookies, headers } from "next/headers";
import { createServerClient } from "@supabase/ssr";
import { createClient as createRawClient } from "@supabase/supabase-js";
import { clientEnv } from "@/lib/env";
import { serverEnv } from "@/lib/env.server";
import type { Database } from "@/types/database";

/**
 * Server Supabase client using session cookies under user RLS.
 *
 * ## Why the caller's headers are forwarded
 *
 * Sign-in runs in a server action, so without this the request GoTrue sees
 * comes from the Next.js server — and `auth.sessions.user_agent` records
 * *that*. Every device in a user's session list then reads "Next.js
 * Middleware" or "Script", which is useless for the one question the list
 * exists to answer: do I recognise this?
 *
 * Forwarding the browser's own `user-agent` and its address makes GoTrue
 * record the real client. `x-forwarded-for` is what GoTrue reads for the
 * session IP, and the value is taken from the platform's own header
 * (Vercel/Cloudflare set it upstream of the app), never from anything the
 * browser can set for itself.
 */
export async function createServerSupabaseClient() {
  const cookieStore = await cookies();
  const requestHeaders = await headers();

  const forwarded: Record<string, string> = {};
  const userAgent = requestHeaders.get("user-agent");
  if (userAgent) forwarded["user-agent"] = userAgent;

  const clientIp =
    requestHeaders.get("cf-connecting-ip") ??
    requestHeaders.get("x-real-ip") ??
    requestHeaders.get("x-forwarded-for")?.split(",")[0]?.trim();
  if (clientIp) forwarded["x-forwarded-for"] = clientIp;

  return createServerClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      global: { headers: forwarded },
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            for (const { name, value, options } of cookiesToSet) {
              cookieStore.set(name, value, options);
            }
          } catch {
            // Ignored when called in Server Components.
          }
        },
      },
    },
  );
}

// Service-role Supabase client bypassing RLS.
export function createServiceRoleClient() {
  if (!serverEnv.SUPABASE_SERVICE_ROLE_KEY) {
    throw new Error(
      "SUPABASE_SERVICE_ROLE_KEY is not configured. Service-role operations are unavailable until it is set.",
    );
  }

  return createRawClient<Database>(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    serverEnv.SUPABASE_SERVICE_ROLE_KEY,
    {
      auth: { autoRefreshToken: false, persistSession: false },
    },
  );
}
