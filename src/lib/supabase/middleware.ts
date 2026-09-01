import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { clientEnv } from "@/lib/env";

export interface MiddlewareSessionUser {
  id: string;
  email: string | null;
}

/**
 * Refreshes auth session cookies and identifies the caller.
 *
 * ## Why `getClaims()` rather than `getUser()`
 *
 * This runs on *every* request, including static-ish pages and API routes.
 * `getUser()` always makes a network call to the Supabase auth server —
 * measured at ~165ms from here — so it was adding that to the floor of
 * every single response.
 *
 * `getClaims()` verifies the access token's signature locally against the
 * project's JWKS (fetched once per process, then cached), which costs
 * about 1ms. It still reads the session from cookies and still refreshes
 * an expired token, so the cookie-refresh guarantee below is unchanged.
 *
 * The `getUser()` fallback stays for the cases `getClaims()` cannot handle
 * on its own — a legacy HS256 token, or a JWKS fetch that fails — so a
 * transient failure downgrades to the slow path instead of signing
 * everybody out.
 */
export async function updateSupabaseSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    clientEnv.NEXT_PUBLIC_SUPABASE_URL,
    clientEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          for (const { name, value } of cookiesToSet) {
            request.cookies.set(name, value);
          }
          for (const { name, value, options } of cookiesToSet) {
            response.cookies.set(name, value, options);
          }
        },
      },
    },
  );

  // IMPORTANT: do not remove. Reading the session here is what refreshes
  // the auth cookies, and it must run on every request for auth to keep
  // working reliably.
  let user: MiddlewareSessionUser | null = null;

  try {
    const { data, error } = await supabase.auth.getClaims();
    const claims = data?.claims as { sub?: string; email?: string } | undefined;
    if (!error && claims?.sub) {
      user = { id: claims.sub, email: claims.email ?? null };
      return { response, user };
    }
  } catch {
    // Fall through to the network path below.
  }

  const {
    data: { user: fetched },
  } = await supabase.auth.getUser();
  user = fetched ? { id: fetched.id, email: fetched.email ?? null } : null;

  return { response, user };
}
