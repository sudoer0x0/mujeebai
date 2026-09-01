"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { SUPPORTED_CURRENCIES } from "@/billing/currencies";
import { CURRENCY_COOKIE, CURRENCY_COOKIE_MAX_AGE } from "@/billing/currency-preference";

const schema = z.object({ currency: z.enum(SUPPORTED_CURRENCIES) });

/**
 * Remembers which currency this visitor wants to see prices in.
 *
 * Deliberately a cookie rather than a profile column: the pricing page is
 * public, so the person choosing may not have an account yet, and asking
 * them to sign up before they can see a price in their own currency is
 * backwards.
 *
 * The value is validated against the supported list before it is written,
 * so the cookie can only ever hold one of eight known strings. It is read
 * back through `resolveRequestCurrency`, which validates it *again*
 * against what the deployment can actually sell in — a cookie set before
 * an operator removed a currency's prices must not strand somebody on an
 * unsellable one.
 *
 * `httpOnly` is false because nothing here is a secret, and it keeps the
 * door open to reading it before paint as the theme and font cookies do.
 */
export async function setCurrencyPreferenceAction(input: unknown): Promise<{ ok: boolean }> {
  const parsed = schema.safeParse(input);
  if (!parsed.success) return { ok: false };

  const jar = await cookies();
  jar.set(CURRENCY_COOKIE, parsed.data.currency, {
    maxAge: CURRENCY_COOKIE_MAX_AGE,
    path: "/",
    sameSite: "lax",
    httpOnly: false,
  });

  // Prices are rendered on the server, so the page has to be re-rendered
  // for the change to be visible at all.
  revalidatePath("/", "layout");
  return { ok: true };
}
