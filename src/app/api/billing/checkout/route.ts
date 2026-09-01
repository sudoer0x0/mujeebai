import { NextResponse } from "next/server";
import { z } from "zod";
import { nanoid } from "nanoid";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { initializeTransaction, PaystackNotConfiguredError } from "@/billing/paystack";
import { clientEnv } from "@/lib/env";
import { checkRateLimit } from "@/lib/rate-limit";
import { listPlansWithEntitlements } from "@/billing/pricing";
import { enabledCurrencies, resolveRequestCurrency } from "@/billing/currency-preference";
import { logger } from "@/lib/logger";
import { minorUnitFactor } from "@/billing/currencies";

const bodySchema = z.object({
  planSlug: z.string().max(64).default("pro"),
  // There is deliberately no `currency` field.
  //
  // It used to accept one, loosely validated as any three characters. It
  // was not exploitable — the amount is always read from the database for
  // whichever currency is named, so a caller could not invent a price —
  // but it let the browser steer a Paystack call toward a currency the
  // merchant account may not have enabled, and it made "what will I be
  // charged in?" a question with a client-supplied answer.
  //
  // The server now derives it: the visitor's cookie preference, validated
  // twice (once when written, once against what this deployment can
  // actually sell in), falling back to the configured default. The
  // browser has no say beyond a preference it already expressed.
});

// Initiates subscription checkout.
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`billing-checkout:${user.id}`, 10, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "billing.checkoutError" }, { status: 429 });

  const parsed = bodySchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const { data: plan } = await supabase
    .from("plans")
    .select("*")
    .eq("slug", parsed.data.planSlug)
    .eq("is_active", true)
    .maybeSingle();

  if (!plan) return NextResponse.json({ error: "billing.checkoutError" }, { status: 404 });

  const currency = (await resolveRequestCurrency(enabledCurrencies(await listPlansWithEntitlements()))).toUpperCase();
  const currencyPrices = (plan.currency_prices ?? {}) as Record<string, number>;

  // A plan with no price in the charging currency must not silently fall
  // back to its USD figure — billing ₦10 instead of ₦15,000 because the
  // number happened to be there is far worse than refusing.
  const amountMajor = currency === "USD" ? Number(plan.price_usd) : currencyPrices[currency];
  if (!Number.isFinite(amountMajor) || amountMajor <= 0) {
    logger.error("checkout_missing_currency_price", { plan: plan.slug, currency });
    return NextResponse.json({ error: "billing.checkoutError", reason: "no_price" }, { status: 409 });
  }

  // Not a flat *100: XOF has no subunit, and multiplying it would charge
  // a hundred times the listed price. See src/billing/currencies.ts.
  const amountMinorUnits = Math.round(amountMajor * minorUnitFactor(currency));
  const planCode = (plan.metadata as Record<string, string> | null)?.paystack_plan_code;

  const reference = `mujeeb_${plan.slug}_${nanoid()}`;

  try {
    const transaction = await initializeTransaction({
      email: user.email ?? "",
      amountMinorUnits,
      currency,
      reference,
      planCode,
      callbackUrl: `${clientEnv.NEXT_PUBLIC_SITE_URL}/api/billing/callback`,
      metadata: { userId: user.id, planId: plan.id },
    });

    // `accessCode` lets the browser open Paystack's own modal instead of
    // navigating away. The amount and currency stay server-decided — the
    // client resumes a transaction it cannot alter, rather than declaring
    // one. `authorizationUrl` remains as the fallback path.
    return NextResponse.json({
      authorizationUrl: transaction.authorization_url,
      accessCode: transaction.access_code,
      reference,
    });
  } catch (error) {
    if (error instanceof PaystackNotConfiguredError) {
      return NextResponse.json({ error: "billing.checkoutError", reason: "not_configured" }, { status: 503 });
    }
    return NextResponse.json({ error: "billing.checkoutError" }, { status: 502 });
  }
}
