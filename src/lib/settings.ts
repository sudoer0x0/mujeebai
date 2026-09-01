import "server-only";
import { cache } from "react";
import { getRegistry } from "@/lib/cached-registry";
import type { Json } from "@/types/database";

/**
 * Typed access to `system_settings`.
 *
 * Every value an administrator can change without a deploy is read
 * through here, and every read carries a fallback — a missing or
 * malformed row must degrade to a sane default rather than take a page
 * down. The whole table is loaded once per request and cached, so
 * reading six settings costs one query, not six.
 */

export const SETTING_DEFAULTS = {
  billing_currency: "NGN",
  default_model_slug: "mujeeb-free",
  default_vision_model_slug: "mujeeb-vision",
  default_locale: "en",
  support_email: "security@yungswag.xyz",
  free_plan_slug: "free",
  max_upload_size_mb: 25,
  chat_rate_limit_per_minute: 20,
  max_conversation_messages: 200,
  // Widened deliberately: `as const` would narrow this to the literal
  // `true`, and the reader below needs to compare against `false`.
  staff_require_mfa_each_signin: true as boolean,
  announcement: null as string | null,
} as const;

export type SettingKey = keyof typeof SETTING_DEFAULTS;

const loadAll = cache(async (): Promise<Record<string, Json>> => {
  try {
    const { settings } = await getRegistry();
    return settings;
  } catch {
    // A settings read must never be the thing that breaks a page.
    return {};
  }
});

export async function getSetting<K extends SettingKey>(
  key: K,
): Promise<(typeof SETTING_DEFAULTS)[K]> {
  const all = await loadAll();
  const value = all[key];
  const fallback = SETTING_DEFAULTS[key];

  if (value === undefined || value === null) return fallback;

  // Guard the type: a hand-edited row holding the wrong shape should fall
  // back rather than propagate a string where a number is expected.
  if (typeof fallback === "number") {
    const numeric = typeof value === "number" ? value : Number(value);
    return (Number.isFinite(numeric) ? numeric : fallback) as (typeof SETTING_DEFAULTS)[K];
  }
  if (typeof fallback === "string") {
    return (typeof value === "string" && value.trim() ? value : fallback) as (typeof SETTING_DEFAULTS)[K];
  }

  return value as (typeof SETTING_DEFAULTS)[K];
}

/**
 * The currency checkout should charge in.
 *
 * Not a constant: Paystack rejects any currency the merchant profile does
 * not have enabled, and which those are is account configuration. This
 * deployment's live account supports NGN only.
 */
/**
 * Whether a staff sign-in must be stepped up with an authenticator code.
 *
 * Defaults to **true**, including when the row is missing or malformed.
 * A gate whose default is "off" fails open, and the whole value of a
 * second factor is that it is asked for.
 */
export async function requiresMfaEachSignIn(): Promise<boolean> {
  // Only an explicit `false` turns this off. `Boolean(value)` would have
  // been true for the string "false", and — worse — any read failure would
  // have to be interpreted, so the safe reading is "required unless
  // someone deliberately said otherwise".
  return (await getSetting("staff_require_mfa_each_signin")) !== false;
}

export async function getBillingCurrency(): Promise<string> {
  const currency = await getSetting("billing_currency");
  return currency.toUpperCase();
}
