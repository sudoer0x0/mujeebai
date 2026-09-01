import { NextResponse, type NextRequest } from "next/server";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { routing } from "@/i18n/routing";
import { safeNextPath } from "@/lib/safe-redirect";
import { sendWelcomeEmail } from "@/auth/registration";
import { logger } from "@/lib/logger";
import type { EmailOtpType } from "@supabase/supabase-js";

const ALLOWED_TYPES: EmailOtpType[] = ["signup", "magiclink", "recovery", "invite", "email_change"];

/**
 * Redeems a one-time token from an email we sent ourselves (see
 * `src/auth/registration.ts`) and establishes the session.
 *
 * This is the counterpart to `/api/auth/callback`, which handles the PKCE
 * `?code=` links produced by Supabase's own mailer. Both stay supported
 * so a deployment can use either delivery path.
 */
export async function GET(request: NextRequest) {
  const { searchParams, origin } = request.nextUrl;

  const tokenHash = searchParams.get("token_hash");
  const typeParam = searchParams.get("type") as EmailOtpType | null;
  const localeParam = searchParams.get("locale");
  const locale = routing.locales.includes(localeParam as (typeof routing.locales)[number])
    ? localeParam!
    : routing.defaultLocale;
  const next = safeNextPath(searchParams.get("next"), "/chat");

  if (!tokenHash || !typeParam || !ALLOWED_TYPES.includes(typeParam)) {
    return NextResponse.redirect(new URL(`/${locale}/login?error=invalid_link`, origin));
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.verifyOtp({ token_hash: tokenHash, type: typeParam });

  if (error) {
    logger.warn("auth_confirm_failed", { type: typeParam, reason: error.message });
    return NextResponse.redirect(new URL(`/${locale}/login?error=expired_link`, origin));
  }

  // First-time confirmation: greet the user once, and only once. The
  // `welcomed_at` marker lives in auth metadata so a second click on the
  // same link (or a later magic-link sign-in) doesn't re-send it.
  if (data.user && !data.user.user_metadata?.welcomed_at) {
    try {
      const admin = createServiceRoleClient();
      await admin.auth.admin.updateUserById(data.user.id, {
        user_metadata: { ...data.user.user_metadata, welcomed_at: new Date().toISOString() },
      });
      const { data: profile } = await admin
        .from("profiles")
        .select("display_name, locale")
        .eq("id", data.user.id)
        .maybeSingle();
      await sendWelcomeEmail({
        email: data.user.email ?? "",
        locale: profile?.locale ?? locale,
        displayName: profile?.display_name ?? undefined,
      });
    } catch (welcomeError) {
      // A welcome email is never worth failing a confirmation over.
      logger.warn("welcome_email_failed", { error: String(welcomeError) });
    }
  }

  return NextResponse.redirect(new URL(`/${locale}${next}`, origin));
}
