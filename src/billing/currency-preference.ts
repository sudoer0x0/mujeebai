import "server-only";
import { cookies } from "next/headers";
import { SUPPORTED_CURRENCIES, isSupportedCurrency, type SupportedCurrency } from "@/billing/currencies";
import { getBillingCurrency } from "@/lib/settings";
import { resolveAmount, type ResolvedPlan } from "@/billing/pricing";

export const CURRENCY_COOKIE = "MUJEEB_CURRENCY";
/** A year. A price preference is not something to re-ask every session. */
export const CURRENCY_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

/**
 * Which currencies the pricing UI may actually offer.
 *
 * ## The rule
 *
 * A currency is offerable only when **every paid plan** has a price in
 * it. Anything looser produces the worst version of this feature: a
 * customer switches to KES, one plan shows a price and the other says
 * "unavailable", and the page looks broken rather than deliberate. The
 * currencies a deployment can sell in are whatever its operator has
 * finished pricing, and that is exactly what this computes.
 *
 * USD is special only in storage — it lives in `plans.price_usd` rather
 * than in the `currency_prices` map — and `resolveAmount` already hides
 * that, so it is not special-cased here.
 *
 * ## Why derived rather than configured
 *
 * A separate "enabled currencies" setting would be a second source of
 * truth that drifts from the prices. Deriving it means an operator adds a
 * NGN price to every plan and NGN simply appears in the switcher — there
 * is no second step to forget.
 */
export function enabledCurrencies(plans: ResolvedPlan[]): SupportedCurrency[] {
  // "Paid" means a plan that actually charges something *somewhere* — not
  // one that merely has a currency key. The free plan in this deployment
  // carries `{"NGN": 0}`, and testing for the key's presence rather than
  // its value pulled it into the set every currency then had to satisfy.
  // Since a free plan can never have an amount above zero, that silently
  // emptied the list and the switcher never appeared.
  const paid = plans.filter(
    (plan) => plan.priceUsd > 0 || Object.values(plan.currencyPrices).some((amount) => Number(amount) > 0),
  );

  // No paid plan means nothing to price. Offering a switcher over a single
  // free plan is noise.
  if (paid.length === 0) return [];

  return SUPPORTED_CURRENCIES.filter((code) =>
    paid.every((plan) => {
      const amount = resolveAmount(plan, code);
      return amount !== null && amount.major > 0;
    }),
  );
}

/**
 * The currency to price this request in.
 *
 * Order: the visitor's own choice, then the platform default, then USD.
 * Each step is validated against `available` rather than trusted — a
 * cookie is attacker-controlled input, and one carrying `"; DROP"` or a
 * currency the deployment cannot sell in must fall through to the default
 * rather than reach a price lookup or a Paystack call.
 *
 * Note that a currency here only ever *selects* a price the operator
 * already stored. It never scales, converts or computes one, so choosing
 * a currency cannot change what a plan costs.
 */
export async function resolveRequestCurrency(available: SupportedCurrency[]): Promise<string> {
  const fallback = await getBillingCurrency();

  if (available.length === 0) return fallback;

  const jar = await cookies();
  const chosen = jar.get(CURRENCY_COOKIE)?.value?.toUpperCase();

  if (chosen && isSupportedCurrency(chosen) && available.includes(chosen as SupportedCurrency)) {
    return chosen;
  }

  if (isSupportedCurrency(fallback) && available.includes(fallback as SupportedCurrency)) {
    return fallback;
  }

  // The configured default is not sellable (no plan carries a price in
  // it). Rather than render every price as "unavailable", fall back to
  // the first currency that is actually priced.
  return available[0];
}
