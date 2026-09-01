import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { safeNextPath } from "@/lib/safe-redirect";

// Exchanges Supabase PKCE code for a session and redirects.
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;
  const code = searchParams.get("code");
  const localeParam = searchParams.get("locale");
  const locale = routing.locales.includes(localeParam as (typeof routing.locales)[number])
    ? localeParam!
    : routing.defaultLocale;
  // Normalized so `?next=//evil.com` cannot turn the post-auth redirect
  // into an off-site hop — see src/lib/safe-redirect.ts.
  const next = safeNextPath(searchParams.get("next"), "/chat");

  if (code) {
    const supabase = await createServerSupabaseClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      logger.warn("auth_callback_exchange_failed", { error: error.message });
      return NextResponse.redirect(new URL(`/${locale}/login?error=auth`, origin));
    }
  }

  return NextResponse.redirect(new URL(`/${locale}${next}`, origin));
}
