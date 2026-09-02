"use server";

import { z } from "zod";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/rate-limit";
import { getClientIp } from "@/lib/request-ip";
import { isFeatureEnabled } from "@/lib/feature-flags";
import { registerUser, sendAuthLink } from "@/auth/registration";
import { safeNextPath } from "@/lib/safe-redirect";
import { clientEnv } from "@/lib/env";
import { redirect } from "next/navigation";
import { routing } from "@/i18n/routing";
import { logger } from "@/lib/logger";
import { recordSessionLocation } from "@/auth/session-location";
import { cookies, headers } from "next/headers";
import { FONT_COOKIE, FONT_COOKIE_MAX_AGE, toFontChoice } from "@/lib/fonts";

export interface ActionResult {
  ok: boolean;
  /** A message-catalog key, never a raw provider string. */
  error?: string;
  message?: string;
  /** Set when the account is usable immediately (no verification step). */
  sessionCreated?: boolean;
}

const nameSchema = z.string().trim().min(1).max(100);
const emailSchema = z.string().trim().toLowerCase().email().max(320);
const passwordSchema = z.string().min(8).max(200);

function resolveLocale(value: FormDataEntryValue | null): string {
  const locale = String(value ?? routing.defaultLocale);
  return routing.locales.includes(locale as (typeof routing.locales)[number]) ? locale : routing.defaultLocale;
}

// IP-based throttle for auth server actions.
async function assertNotRateLimited(action: string, limit: number, windowMs: number): Promise<ActionResult | null> {
  const ip = await getClientIp();
  const { allowed } = checkRateLimit(`auth:${action}:${ip}`, limit, windowMs);
  if (!allowed) return { ok: false, error: "auth.errors.rateLimited" };
  return null;
}

export async function signUpAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const limited = await assertNotRateLimited("signup", 10, 60_000);
  if (limited) return limited;

  // Honour the admin-controlled registration switch. This is a real gate,
  // not a UI hint: the sign-up form is also hidden when it's off, but the
  // server is what actually refuses (master spec #68).
  if (!(await isFeatureEnabled("registration"))) {
    return { ok: false, error: "auth.errors.registrationClosed" };
  }

  const firstName = nameSchema.safeParse(formData.get("firstName"));
  const lastName = nameSchema.safeParse(formData.get("lastName"));
  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));
  const confirmPassword = String(formData.get("confirmPassword") ?? "");
  const locale = resolveLocale(formData.get("locale"));

  if (!firstName.success || !lastName.success) {
    return { ok: false, error: "auth.errors.nameRequired" };
  }
  if (!email.success) return { ok: false, error: "auth.errors.invalidEmail" };
  if (!password.success) return { ok: false, error: "auth.errors.weakPassword" };
  if (password.data !== confirmPassword) {
    return { ok: false, error: "auth.errors.passwordMismatch" };
  }

  const displayName = `${firstName.data} ${lastName.data}`.replace(/\s+/g, " ").trim();

  const outcome = await registerUser({
    email: email.data,
    password: password.data,
    displayName,
    firstName: firstName.data,
    lastName: lastName.data,
    locale,
  });

  switch (outcome.status) {
    case "verification_sent":
      return { ok: true, message: "auth.verify.subtitle" };
    case "session_created":
      return { ok: true, sessionCreated: true };
    case "already_exists":
      return { ok: false, error: "auth.errors.userAlreadyExists" };
    case "registration_closed":
      return { ok: false, error: "auth.errors.registrationClosed" };
    case "email_failed":
      return { ok: false, error: "auth.errors.emailDeliveryFailed" };
    default:
      // Never surface the provider's own wording to the browser.
      logger.error("signup_failed", { reason: outcome.message });
      return { ok: false, error: "auth.errors.generic" };
  }
}

export async function signInAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const limited = await assertNotRateLimited("signin", 15, 60_000);
  if (limited) return limited;

  const email = emailSchema.safeParse(formData.get("email"));
  const password = passwordSchema.safeParse(formData.get("password"));

  if (!email.success || !password.success) {
    return { ok: false, error: "auth.errors.invalidCredentials" };
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithPassword({
    email: email.data,
    password: password.data,
  });

  if (error) {
    const msg = error.message.toLowerCase();
    if (msg.includes("email not confirmed")) {
      return { ok: false, error: "auth.errors.emailNotConfirmed" };
    }
    // Everything else collapses to one message on purpose: distinguishing
    // "no such account" from "wrong password" turns the sign-in form into
    // an account-enumeration oracle.
    return { ok: false, error: "auth.errors.invalidCredentials" };
  }

  // Blocked accounts must not get a usable session. The profile row is
  // the authority on account state; sign the session straight back out
  // rather than letting a suspended user reach the app shell.
  if (data.user) {
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", data.user.id)
      .maybeSingle();

    if (profile && profile.status !== "active") {
      await supabase.auth.signOut();
      return {
        ok: false,
        error: profile.status === "suspended" ? "auth.errors.accountSuspended" : "auth.errors.accountDisabled",
      };
    }
  }

  // Record where this session signed in from, for the device list. Best
  // effort — never allowed to fail a sign-in.
  if (data.session) {
    await recordSessionLocation(data.user!.id, data.session.access_token);
    // Carry the account's saved reading font onto this device, so a new
    // browser gets the right one from its first paint rather than after a
    // visit to Settings.
    await applyFontCookie(supabase, data.user!.id);
  }

  return { ok: true };
}

export async function resendVerificationEmailAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const limited = await assertNotRateLimited("resend-verification", 5, 60_000);
  if (limited) return limited;

  const email = emailSchema.safeParse(formData.get("email"));
  const locale = resolveLocale(formData.get("locale"));
  if (!email.success) return { ok: false, error: "auth.errors.invalidEmail" };

  const { delivered } = await sendAuthLink({ kind: "verify", email: email.data, locale });

  if (!delivered) {
    // Fall back to Supabase's own mailer when we have no provider of our
    // own configured (or the address simply has no pending sign-up).
    const supabase = await createServerSupabaseClient();
    await supabase.auth.resend({
      type: "signup",
      email: email.data,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?locale=${locale}&next=/chat` },
    });
  }

  // Same response either way — see the enumeration note in sendAuthLink.
  return { ok: true, message: "auth.verify.resendSuccess" };
}

export async function magicLinkAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  // Keyed by IP, not email — an attacker enumerating/spamming many
  // addresses from one source is still throttled even though the response
  // never reveals whether any given email has an account.
  const limited = await assertNotRateLimited("magic-link", 5, 60_000);
  if (limited) return limited;

  const email = emailSchema.safeParse(formData.get("email"));
  const locale = resolveLocale(formData.get("locale"));
  if (!email.success) return { ok: false, error: "auth.errors.invalidEmail" };

  const { delivered } = await sendAuthLink({ kind: "magicLink", email: email.data, locale });

  if (!delivered) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.signInWithOtp({
      email: email.data,
      options: { emailRedirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?locale=${locale}&next=/chat` },
    });
  }

  return { ok: true, message: "auth.magicLink.sent" };
}

export async function requestPasswordResetAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const limited = await assertNotRateLimited("password-reset", 5, 60_000);
  if (limited) return limited;

  const email = emailSchema.safeParse(formData.get("email"));
  const locale = resolveLocale(formData.get("locale"));
  if (!email.success) return { ok: false, error: "auth.errors.invalidEmail" };

  const { delivered } = await sendAuthLink({ kind: "reset", email: email.data, locale });

  if (!delivered) {
    const supabase = await createServerSupabaseClient();
    await supabase.auth.resetPasswordForEmail(email.data, {
      redirectTo: `${process.env.NEXT_PUBLIC_SITE_URL}/api/auth/callback?locale=${locale}&next=/update-password`,
    });
  }

  return { ok: true, message: "auth.reset.sent" };
}

export async function updatePasswordAction(_prev: ActionResult, formData: FormData): Promise<ActionResult> {
  const password = passwordSchema.safeParse(formData.get("password"));
  if (!password.success) return { ok: false, error: "auth.errors.weakPassword" };

  const supabase = await createServerSupabaseClient();

  // updateUser only succeeds with a live recovery/authenticated session,
  // which is the actual authorization here — a bare POST with no session
  // cannot change anyone's password.
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "auth.errors.sessionExpired" };

  const { error } = await supabase.auth.updateUser({ password: password.data });
  if (error) {
    logger.warn("password_update_failed", { reason: error.message });
    return { ok: false, error: "auth.errors.generic" };
  }

  return { ok: true, message: "auth.updatePassword.success" };
}

export async function signOutAction() {
  const supabase = await createServerSupabaseClient();
  await supabase.auth.signOut();
}

/**
 * Copies the account's stored font preference into the render cookie.
 *
 * The column is the source of truth; the cookie is what the pre-paint
 * script can actually read. Silent on failure — a default font is never
 * worth failing a sign-in over.
 */
async function applyFontCookie(
  supabase: Awaited<ReturnType<typeof createServerSupabaseClient>>,
  userId: string,
): Promise<void> {
  try {
    const { data } = await supabase.from("profiles").select("font_preference").eq("id", userId).maybeSingle();
    const font = toFontChoice(data?.font_preference);
    const jar = await cookies();
    jar.set(FONT_COOKIE, font, {
      maxAge: FONT_COOKIE_MAX_AGE,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  } catch {
    // Non-fatal by design.
  }
}

/**
 * Starts Google sign-in.
 *
 * ## Why this is a server action rather than a browser call
 *
 * `signInWithOAuth` from the browser would work, but the redirect target
 * would then be composed client-side, which is exactly the value an
 * attacker wants control of in an OAuth flow. Composing it here means the
 * callback URL is always this deployment's own, built from
 * `NEXT_PUBLIC_SITE_URL`, and the only thing the caller influences is a
 * `next` path that has already been normalized by `safeNextPath`.
 *
 * ## What happens on return
 *
 * Google sends the browser to `/api/auth/callback`, which exchanges the
 * PKCE code for a session and redirects to `next`. That route already
 * existed for magic links and needed no changes — an OAuth code and a
 * magic-link code are exchanged identically.
 *
 * A staff account signing in this way still lands in the customer app
 * layout, which redirects it to the right console; the MFA gate then
 * applies as normal. OAuth does not bypass the second factor.
 */
export async function signInWithGoogleAction(formData: FormData): Promise<void> {
  const rawLocale = String(formData.get("locale") ?? "");
  const locale = routing.locales.includes(rawLocale as (typeof routing.locales)[number])
    ? rawLocale
    : routing.defaultLocale;
  const next = safeNextPath(String(formData.get("next") ?? ""), "/chat");

  const headerList = await headers();
  const host = headerList.get("x-forwarded-host") ?? headerList.get("host");
  const proto = headerList.get("x-forwarded-proto") ?? (host?.includes("localhost") ? "http" : "https");
  const origin = host ? `${proto}://${host}` : clientEnv.NEXT_PUBLIC_SITE_URL;

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signInWithOAuth({
    provider: "google",
    options: {
      redirectTo: `${origin}/api/auth/callback?locale=${locale}&next=${encodeURIComponent(next)}`,
      // Ask for a refresh token and force the account chooser, so someone
      // signed into several Google accounts is not silently put into the
      // wrong one.
      queryParams: { access_type: "offline", prompt: "select_account" },
    },
  });

  if (error || !data?.url) {
    logger.warn("google_oauth_start_failed", { error: error?.message });
    redirect(`/${locale}/login?error=oauth`);
  }

  redirect(data.url);
}
