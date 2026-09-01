/**
 * Human labels for the machine keys the console works with.
 *
 * The audit log used to render `admin.plan_currency_prices_updated` in a
 * monospace column, and the settings page listed `chat_rate_limit_per_minute`
 * as its heading. Those are identifiers — correct, but they read as
 * variable names leaking through the UI, and they are not translatable.
 *
 * ## Why there is a fallback rather than only a lookup
 *
 * New keys get added (a new setting, a new audited action) and a
 * translation for one will not always land in the same change. A missing
 * label must degrade to something readable rather than to a blank cell or
 * a raw key, so `humanizeKey` turns `chat_rate_limit_per_minute` into
 * "Chat rate limit per minute" and `admin.user_suspended` into
 * "User suspended". It is a fallback, not the primary path — a key worth
 * showing is worth translating.
 */

/** Words that should keep their casing when a key is humanized. */
const ACRONYMS = new Set(["ai", "api", "id", "url", "mb", "kb", "gb", "ngn", "usd", "ghs", "zar", "kes", "egp", "rwf", "xof", "mfa", "2fa", "totp", "rls", "ip"]);

/**
 * Turns a machine key into a readable phrase.
 *
 * `admin.system_setting_changed` -> "System setting changed"
 * `max_file_size_mb`             -> "Max file size MB"
 */
export function humanizeKey(key: string): string {
  const withoutNamespace = key.includes(".") ? key.slice(key.lastIndexOf(".") + 1) : key;

  const words = withoutNamespace
    .replace(/[_-]+/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

  if (words.length === 0) return key;

  return words
    .map((word, index) => {
      const lower = word.toLowerCase();
      if (ACRONYMS.has(lower)) return lower.toUpperCase();
      // Only the first word is capitalised — sentence case reads better in
      // a dense table than Title Case Applied To Everything.
      return index === 0 ? lower.charAt(0).toUpperCase() + lower.slice(1) : lower;
    })
    .join(" ");
}

/**
 * Every audited action, mapped to its message key under `admin.auditAction`.
 *
 * Listed explicitly rather than derived, so that adding an audited action
 * without a label is visible here rather than discovered in production.
 */
export const AUDIT_ACTION_KEYS = [
  "admin.user_suspended",
  "admin.user_disabled",
  "admin.user_restored",
  "admin.user_deleted",
  "admin.user_invited",
  "admin.sessions_revoked",
  "admin.email_template_saved",
  "admin.email_template_restored",
  "admin.email_template_reset",
  "admin.moderator_created",
  "admin.moderator_removed",
  "admin.password_reset",
  "admin.magic_link_created",
  "admin.verification_resent",
  "admin.quota_changed",
  "admin.quota_reset",
  "admin.plan_updated",
  "admin.plan_currency_prices_updated",
  "admin.feature_flag_changed",
  "admin.system_setting_changed",
  "admin.provider_changed",
  "admin.model_changed",
  "admin.prompt_changed",
  "admin.prompt_restored",
  "account.device_revoked",
  "account.other_devices_revoked",
  "account.all_devices_revoked",
  "admin.moderator_reset",
  "admin.plan_granted",
  "admin.plan_grant_revoked",
  "admin.action_undone",
  "billing.subscription_activated",
  "billing.subscription_created",
  "billing.subscription_cancelled",
  "staff.signin",
  "staff.signin_failed",
  "staff.signin_denied",
  "staff.password_set",
  "staff.mfa_enrolled",
  "staff.sessions_revoked",
  "staff.password_changed",
  "staff.password_change_failed",
] as const;

export type AuditActionKey = (typeof AUDIT_ACTION_KEYS)[number];

export function isKnownAuditAction(action: string): action is AuditActionKey {
  return (AUDIT_ACTION_KEYS as readonly string[]).includes(action);
}
