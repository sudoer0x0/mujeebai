"use server";

import { revalidatePath } from "next/cache";
import { revalidateRegistry } from "@/lib/cached-registry";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { SUPPORTED_CURRENCIES } from "@/billing/currencies";
import type { Json } from "@/types/database";
import type { ActionResponse } from "@/admin/user-actions";

const priceSchema = z.object({
  planId: z.string().uuid(),
  // A negative price would let checkout compute a negative Paystack
  // amount; the upper bound is a sanity guard against a slipped decimal.
  priceUsd: z.number().min(0).max(100_000),
});

export async function updatePlanPriceAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "plans.manage");

    const parsed = priceSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.plans.saveFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("plans")
      .select("price_usd, slug")
      .eq("id", parsed.data.planId)
      .maybeSingle();

    const { error } = await supabase
      .from("plans")
      .update({ price_usd: parsed.data.priceUsd })
      .eq("id", parsed.data.planId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_updated",
      targetType: "plan",
      targetId: parsed.data.planId,
      result: error ? "failure" : "success",
      // Record the previous value too — "price changed to 10" is far less
      // useful during an incident than "changed from 20 to 10".
      metadata: { slug: before?.slug ?? null, from: before?.price_usd ?? null, to: parsed.data.priceUsd },
    });

    if (error) return { ok: false, message: "admin.plans.saveFailed" };

    // The pricing page, settings card and checkout all read this row, so
    // every surface that shows a price has to be revalidated together.
    await revalidateRegistry();
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    revalidatePath("/settings");
    return { ok: true, message: "admin.plans.saved" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("plan_price_update_failed", { error: String(error) });
    return { ok: false, message: "admin.plans.saveFailed" };
  }
}

const currencyPricesSchema = z.object({
  planId: z.string().uuid(),
  // Every supported currency, each optional. An absent or empty entry
  // means "no price in this currency", which is a meaningful state:
  // checkout refuses it and the pricing page says so, rather than
  // charging the USD figure under a different symbol.
  prices: z.record(
    z.enum(SUPPORTED_CURRENCIES),
    z.number().min(0).max(100_000_000).nullable(),
  ),
});

/**
 * Sets a plan's price in every supported currency at once.
 *
 * ## Why this exists
 *
 * `plans.currency_prices` held `{"NGN": 15000}` from a seed migration and
 * there was no way to change it from the console — the only price editor
 * wrote `price_usd`. So the Naira price looked hardcoded from the outside,
 * because in practice it was: changing it meant a SQL statement.
 *
 * Prices are stored per currency rather than converted from USD at
 * display time. A live FX rate would make the listed price move on its own
 * between the moment a customer reads it and the moment they are charged,
 * and would put the product's pricing at the mercy of a third-party rate
 * feed. Switching `billing_currency` now switches to a price an operator
 * chose, which is the behaviour asked for: set every currency once, and
 * changing the default currency picks up the right figure immediately.
 */
export async function updatePlanCurrencyPricesAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "plans.manage");

    const parsed = currencyPricesSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.plans.saveFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("plans")
      .select("slug, currency_prices")
      .eq("id", parsed.data.planId)
      .maybeSingle();

    // Drop nulls rather than storing them: "absent" and "explicitly no
    // price" are the same state, and one representation is easier to
    // reason about than two.
    const next: Record<string, number> = {};
    for (const [code, value] of Object.entries(parsed.data.prices)) {
      if (value === null || value === undefined) continue;
      next[code] = value;
    }

    const { error } = await supabase
      .from("plans")
      .update({ currency_prices: next as Json })
      .eq("id", parsed.data.planId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_currency_prices_updated",
      targetType: "plan",
      targetId: parsed.data.planId,
      result: error ? "failure" : "success",
      metadata: { slug: before?.slug ?? null, from: before?.currency_prices ?? null, to: next as Json },
    });

    if (error) return { ok: false, message: "admin.plans.saveFailed" };

    await revalidateRegistry();
    revalidatePath("/admin/plans");
    revalidatePath("/pricing");
    revalidatePath("/settings");
    return { ok: true, message: "admin.plans.saved" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("plan_currency_prices_update_failed", { error: String(error) });
    return { ok: false, message: "admin.plans.saveFailed" };
  }
}

const entitlementSchema = z.object({
  planId: z.string().uuid(),
  featureKey: z.string().min(1).max(64),
  value: z.union([z.number().int().min(-1).max(1_000_000), z.boolean()]),
});

export async function updateEntitlementAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "plans.manage");

    const parsed = entitlementSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.plans.saveFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("plan_entitlements")
      .select("value")
      .eq("plan_id", parsed.data.planId)
      .eq("feature_key", parsed.data.featureKey)
      .maybeSingle();

    const { error } = await supabase
      .from("plan_entitlements")
      .upsert(
        { plan_id: parsed.data.planId, feature_key: parsed.data.featureKey, value: parsed.data.value },
        { onConflict: "plan_id,feature_key" },
      );

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_updated",
      targetType: "plan_entitlement",
      targetId: `${parsed.data.planId}:${parsed.data.featureKey}`,
      result: error ? "failure" : "success",
      metadata: { from: before?.value ?? null, to: parsed.data.value },
    });

    if (error) return { ok: false, message: "admin.plans.saveFailed" };

    await revalidateRegistry();
    revalidatePath("/admin/plans");
    await revalidateRegistry();
    revalidatePath("/pricing");
    return { ok: true, message: "admin.plans.saved" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("entitlement_update_failed", { error: String(error) });
    return { ok: false, message: "admin.plans.saveFailed" };
  }
}

const paystackSchema = z.object({
  planId: z.string().uuid(),
  planCode: z.string().max(120),
});

export async function updatePaystackPlanCodeAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "plans.manage");

    const parsed = paystackSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.plans.saveFailed" };

    const supabase = createServiceRoleClient();
    const { data: plan } = await supabase
      .from("plans")
      .select("metadata")
      .eq("id", parsed.data.planId)
      .maybeSingle();

    const metadata: Record<string, Json> = { ...((plan?.metadata as Record<string, Json>) ?? {}) };
    const code = parsed.data.planCode.trim();
    // `plans.metadata` is publicly readable (the pricing page reads the
    // row), so only non-secret provider identifiers ever go in here.
    if (code) metadata.paystack_plan_code = code;
    else delete metadata.paystack_plan_code;

    const { error } = await supabase.from("plans").update({ metadata }).eq("id", parsed.data.planId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_updated",
      targetType: "plan",
      targetId: parsed.data.planId,
      result: error ? "failure" : "success",
      metadata: { paystackPlanCodeSet: Boolean(code) },
    });

    if (error) return { ok: false, message: "admin.plans.saveFailed" };

    await revalidateRegistry();
    revalidatePath("/admin/plans");
    return { ok: true, message: "admin.plans.saved" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("paystack_plan_code_update_failed", { error: String(error) });
    return { ok: false, message: "admin.plans.saveFailed" };
  }
}
