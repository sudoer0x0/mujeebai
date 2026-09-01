/**
 * The currencies checkout can charge in.
 *
 * One list, imported by everything: the settings validator, the plan
 * editor, the pricing page and the checkout route. It used to be a literal
 * `z.enum([...])` inside the settings action, which meant adding a
 * currency required editing several files that had no way of knowing about
 * each other — and a plan could be given a price in a currency the
 * settings validator would then refuse to select.
 *
 * The list is what **Paystack** supports. Whether a *particular* merchant
 * account has one enabled is account configuration that this codebase
 * cannot know: Paystack answers a disabled currency with a 403,
 * "Currency not supported by merchant". The checkout route surfaces that
 * rejection rather than guessing, and `/admin/settings` documents it.
 */

export const SUPPORTED_CURRENCIES = ["NGN", "USD", "GHS", "ZAR", "KES", "XOF", "EGP", "RWF"] as const;

export type SupportedCurrency = (typeof SUPPORTED_CURRENCIES)[number];

export function isSupportedCurrency(value: string): value is SupportedCurrency {
  return (SUPPORTED_CURRENCIES as readonly string[]).includes(value.toUpperCase());
}

/**
 * Currencies with no minor unit.
 *
 * Paystack expects amounts in the minor unit — kobo for NGN, cents for
 * USD — so an amount is normally multiplied by 100. XOF has no subunit at
 * all, and multiplying it by 100 would charge a customer one hundred times
 * the listed price. This is the kind of detail that only ever surfaces as
 * a chargeback, so it lives next to the currency list rather than inside
 * whichever function happened to need it first.
 */
export const ZERO_DECIMAL_CURRENCIES: readonly string[] = ["XOF"];

export function minorUnitFactor(currency: string): number {
  return ZERO_DECIMAL_CURRENCIES.includes(currency.toUpperCase()) ? 1 : 100;
}

/** Human label for the console, e.g. "NGN — Nigerian Naira". */
export const CURRENCY_LABELS: Record<SupportedCurrency, string> = {
  NGN: "Nigerian Naira",
  USD: "US Dollar",
  GHS: "Ghanaian Cedi",
  ZAR: "South African Rand",
  KES: "Kenyan Shilling",
  EGP: "Egyptian Pound",
  RWF: "Rwandan Franc",
  XOF: "West African CFA Franc",
};
