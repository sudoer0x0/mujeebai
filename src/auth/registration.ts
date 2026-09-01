import "server-only";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { clientEnv } from "@/lib/env";
import { providerStatus } from "@/lib/env.server";
import { buildAuthEmail, type AuthEmailKind } from "@/notifications/templates/auth";
import { sendEmail } from "@/notifications";
import { logger } from "@/lib/logger";

/**
 * Server-side registration and account-recovery email flows.
 *
 * ## Why this exists instead of plain `supabase.auth.signUp()`
 *
 * `signUp()` asks Supabase's own mailer to deliver the confirmation
 * email, and Supabase's built-in SMTP only delivers to addresses on the
 * project team (with a very low hourly cap). When it refuses, GoTrue
 * returns HTTP 500 "Error sending confirmation email" and **rolls the
 * whole sign-up transaction back** — the account is never created. That
 * is a hard registration outage for every real user, and it is exactly
 * what this project was hitting.
 *
 * So we own the mail instead: `admin.generateLink()` creates the user and
 * hands back a `hashed_token` *without* sending anything, and we deliver
 * our own branded, localized message through the notification adapter
 * (Resend today). The token is redeemed at `/api/auth/confirm` via
 * `verifyOtp`, which is the same verification GoTrue would have done.
 *
 * If no email provider is configured we fall back to `signUp()` so a
 * deployment that *has* working Supabase SMTP still works unchanged.
 */

export type RegistrationOutcome =
  | { status: "verification_sent" }
  | { status: "session_created" }
  | { status: "already_exists" }
  | { status: "registration_closed" }
  | { status: "email_failed" }
  | { status: "error"; message: string };

interface RegisterParams {
  email: string;
  password: string;
  displayName: string;
  firstName: string;
  lastName: string;
  locale: string;
}

function confirmUrl(params: { tokenHash: string; type: string; locale: string; next: string }) {
  const url = new URL("/api/auth/confirm", clientEnv.NEXT_PUBLIC_SITE_URL);
  url.searchParams.set("token_hash", params.tokenHash);
  url.searchParams.set("type", params.type);
  url.searchParams.set("locale", params.locale);
  url.searchParams.set("next", params.next);
  return url.toString();
}

/** True when we can run the owned-email registration path. */
export function canSelfDeliverAuthEmail(): boolean {
  return providerStatus.resend && providerStatus.supabaseServiceRole;
}

export async function registerUser(params: RegisterParams): Promise<RegistrationOutcome> {
  if (!canSelfDeliverAuthEmail()) {
    return registerViaSupabaseMailer(params);
  }

  const admin = createServiceRoleClient();

  const { data, error } = await admin.auth.admin.generateLink({
    type: "signup",
    email: params.email,
    password: params.password,
    options: {
      data: {
        first_name: params.firstName,
        last_name: params.lastName,
        display_name: params.displayName,
        full_name: params.displayName,
        locale: params.locale,
      },
      redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/${params.locale}/chat`,
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already been registered") || message.includes("already registered")) {
      return { status: "already_exists" };
    }
    logger.error("registration_generate_link_failed", { reason: error.message });
    return { status: "error", message: error.message };
  }

  const user = data.user;
  const tokenHash = data.properties?.hashed_token;
  if (!user || !tokenHash) {
    return { status: "error", message: "Supabase did not return a verification token." };
  }

  // The `handle_new_auth_user` trigger provisions the profile row, but it
  // has historically landed with a null display_name on this project.
  // Set it explicitly from the values the user actually typed rather than
  // depending on the trigger's coalesce chain.
  await admin
    .from("profiles")
    .update({ display_name: params.displayName, locale: params.locale })
    .eq("id", user.id);

  const message = await buildAuthEmail("verify", {
    to: params.email,
    locale: params.locale,
    displayName: params.displayName,
    actionUrl: confirmUrl({ tokenHash, type: "signup", locale: params.locale, next: "/chat" }),
  });

  const result = await sendEmail(message);

  if (!result.delivered) {
    // Roll the account back so the user can simply try again instead of
    // being permanently stuck as an unverified account that can never be
    // signed into and whose email now reports "already registered".
    await admin.auth.admin.deleteUser(user.id).catch(() => undefined);
    logger.error("registration_email_failed_rolled_back", { userId: user.id });
    return { status: "email_failed" };
  }

  logger.info("registration_verification_sent", { userId: user.id });
  return { status: "verification_sent" };
}

/** Legacy path: let Supabase's own mailer deliver the confirmation email. */
async function registerViaSupabaseMailer(params: RegisterParams): Promise<RegistrationOutcome> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.auth.signUp({
    email: params.email,
    password: params.password,
    options: {
      emailRedirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/auth/callback?locale=${params.locale}&next=/chat`,
      data: {
        first_name: params.firstName,
        last_name: params.lastName,
        display_name: params.displayName,
        full_name: params.displayName,
        locale: params.locale,
      },
    },
  });

  if (error) {
    const message = error.message.toLowerCase();
    if (message.includes("already registered") || message.includes("already exists")) {
      return { status: "already_exists" };
    }
    if (message.includes("sending confirmation email") || message.includes("error sending")) {
      logger.error("registration_supabase_mailer_failed", { reason: error.message });
      return { status: "email_failed" };
    }
    return { status: "error", message: error.message };
  }

  // Supabase returns a user with an empty `identities` array when the
  // address is already taken — its way of not confirming account
  // existence to an unauthenticated caller.
  if (data.user && Array.isArray(data.user.identities) && data.user.identities.length === 0) {
    return { status: "already_exists" };
  }

  return data.session ? { status: "session_created" } : { status: "verification_sent" };
}

/**
 * Sends a one-time auth link (verification resend, password reset, magic
 * link) through our own mailer.
 *
 * Always resolves to `true` for reset/magic-link flows regardless of
 * whether the address exists — the caller shows the same message either
 * way so the endpoint can't be used to enumerate accounts
 * (SECURITY.md#Account Enumeration).
 */
export async function sendAuthLink(params: {
  kind: Extract<AuthEmailKind, "verify" | "reset" | "magicLink" | "invite" | "vipInvite">;
  email: string;
  locale: string;
  next?: string;
}): Promise<{ delivered: boolean }> {
  if (!canSelfDeliverAuthEmail()) return { delivered: false };

  const admin = createServiceRoleClient();

  // `recovery` is the reset flow. For both the verification *resend* and
  // the passwordless sign-in we use `magiclink`: redeeming a magic-link
  // OTP also marks an unconfirmed address as confirmed, which is exactly
  // what a verification resend needs to accomplish, and unlike
  // `type: "signup"` it does not require us to know the user's password.
  // A VIP invitation redeems exactly like a magic link — the difference
  // is entirely in the copy wrapped around it, never in the mechanism.
  const linkType = params.kind === "reset" ? "recovery" : "magiclink";
  const next = params.next ?? (params.kind === "reset" ? "/update-password" : "/chat");

  const { data, error } = await admin.auth.admin.generateLink({
    type: linkType,
    email: params.email,
    options: { redirectTo: `${clientEnv.NEXT_PUBLIC_SITE_URL}/${params.locale}${next}` },
  });

  if (error || !data.properties?.hashed_token) {
    // Most commonly "user not found" — expected for the enumeration-safe
    // flows, so this is a debug-level event, not an error.
    logger.debug("auth_link_not_generated", { kind: params.kind });
    return { delivered: false };
  }

  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", data.user?.id ?? "")
    .maybeSingle();

  const message = await buildAuthEmail(params.kind, {
    to: params.email,
    locale: params.locale,
    displayName: profile?.display_name ?? undefined,
    actionUrl: confirmUrl({
      tokenHash: data.properties.hashed_token,
      type: linkType === "recovery" ? "recovery" : "magiclink",
      locale: params.locale,
      next,
    }),
  });

  const result = await sendEmail(message);
  return { delivered: result.delivered };
}

/** Fire-and-forget welcome email, sent once the account is confirmed. */
export async function sendWelcomeEmail(params: { email: string; locale: string; displayName?: string }) {
  const message = await buildAuthEmail("welcome", {
    to: params.email,
    locale: params.locale,
    displayName: params.displayName,
    actionUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/${params.locale}/chat`,
  });
  await sendEmail(message);
}
