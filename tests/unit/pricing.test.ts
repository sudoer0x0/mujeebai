import test from "node:test";
import assert from "node:assert/strict";
import { resolveAmount, formatPrice, quotaOf, hasFeature, type ResolvedPlan } from "@/billing/pricing";

function plan(overrides: Partial<ResolvedPlan> = {}): ResolvedPlan {
  return {
    id: "00000000-0000-0000-0000-000000000001",
    slug: "pro",
    name: "Mujeeb AI Pro",
    description: null,
    priceUsd: 10,
    currencyPrices: { NGN: 15000 },
    billingInterval: "month",
    isDefault: false,
    isActive: true,
    sortOrder: 1,
    entitlements: {
      messages_per_day: 500,
      image_generations_per_day: 50,
      premium_models: true,
      advanced_models: false,
    },
    ...overrides,
  };
}

test("resolveAmount uses the plan's USD price by default", () => {
  const amount = resolveAmount(plan(), "USD");
  assert.ok(amount);
  assert.equal(amount.major, 10);
  // Paystack charges in minor units; a rounding slip here bills 100x.
  assert.equal(amount.minor, 1000);
  assert.equal(amount.currency, "USD");
});

test("resolveAmount uses a configured regional price when present", () => {
  const amount = resolveAmount(plan(), "ngn");
  assert.ok(amount);
  assert.equal(amount.major, 15000);
  assert.equal(amount.minor, 1_500_000);
  assert.equal(amount.currency, "NGN");
});

test("resolveAmount returns null for a currency with no configured price", () => {
  // Deliberately NOT a fallback to the USD figure. Doing that rendered a
  // $10 plan as "₦10" on the pricing page — the USD number wearing a
  // Naira symbol — while checkout refused the same purchase. Display and
  // billing have to agree, so "no price" is its own answer.
  assert.equal(resolveAmount(plan(), "GHS"), null);
});

test("resolveAmount handles fractional prices without floating-point drift", () => {
  assert.equal(resolveAmount(plan({ priceUsd: 19.99 }), "USD")?.minor, 1999);
  assert.equal(resolveAmount(plan({ priceUsd: 0.1 }), "USD")?.minor, 10);
});

test("resolveAmount does not add a minor unit to zero-decimal currencies", () => {
  // XOF has no subunit. Multiplying by 100 the way every other currency
  // requires would charge a customer one hundred times the listed price.
  const amount = resolveAmount(plan({ currencyPrices: { XOF: 3000 } }), "XOF");
  assert.ok(amount);
  assert.equal(amount.major, 3000);
  assert.equal(amount.minor, 3000);
});

test("a free plan resolves to zero rather than to a missing price", () => {
  const amount = resolveAmount(plan({ priceUsd: 0, currencyPrices: {} }), "USD");
  assert.ok(amount);
  assert.equal(amount.major, 0);
  assert.equal(amount.minor, 0);
});

test("formatPrice renders the viewer's locale conventions", () => {
  assert.match(formatPrice(10, "USD", "en"), /\$\s?10/);
  // Whole amounts drop the cents; fractional ones keep them.
  assert.match(formatPrice(19.99, "USD", "en"), /19\.99/);
  assert.doesNotMatch(formatPrice(10, "USD", "en"), /10\.00/);
});

test("quotaOf reads numeric entitlements and the unlimited convention", () => {
  assert.equal(quotaOf(plan(), "messages_per_day"), 500);
  assert.equal(quotaOf(plan({ entitlements: { messages_per_day: -1 } }), "messages_per_day"), "unlimited");
  assert.equal(quotaOf(plan({ entitlements: {} }), "messages_per_day"), null);
  // Zero is a real state ("this plan does not include the feature") and
  // must not be confused with "no entitlement configured".
  assert.equal(quotaOf(plan({ entitlements: { messages_per_day: 0 } }), "messages_per_day"), 0);
});

test("hasFeature reads access-style entitlements", () => {
  assert.equal(hasFeature(plan(), "premium_models"), true);
  assert.equal(hasFeature(plan(), "advanced_models"), false);
  assert.equal(hasFeature(plan({ entitlements: {} }), "premium_models"), false);
});
