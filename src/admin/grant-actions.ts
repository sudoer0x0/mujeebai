"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { revalidateRegistry } from "@/lib/cached-registry";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

/**
 * Complimentary plan access — "give this account Pro, no charge".
 *
 * ## How it works
 *
 * It writes a subscription row like any other, but with
 * `billing_provider: 'manual'` and no provider reference. Everything
 * downstream — entitlements, quotas, the plan shown in Settings — already
 * resolves through the subscription, so a granted plan behaves exactly
 * like a paid one without a second code path to keep in step.
 *
 * ## Why `manual` matters
 *
 * The Paystack webhook matches on `provider_subscription_code`, which a
 * granted row does not have, so a real payment later cannot be confused
 * with a grant and a grant cannot be mistaken for revenue. It also means
 * the billing reports can exclude it.
 *
 * ## Why it expires
 *
 * A grant with no end date is indistinguishable from a billing bug six
 * months later. The default is 30 days and the maximum is a year; the
 * subscription simply lapses, which the existing period-end logic already
 * handles.
 *
 * Both roles may grant. It is a support gesture — an apology for an
 * outage, a trial for a prospect — and it cannot change a price or take
 * a payment. Every grant is audited with its expiry.
 */

const grantSchema = z.object({
  userId: z.string().uuid(),
  planSlug: z.string().min(1).max(64),
  days: z.number().int().min(1).max(365).default(30),
  reason: z.string().trim().max(300).optional(),
});

export async function grantPlanAccessAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "subscriptions.grant");

    const parsed = grantSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.grants.invalid" };

    const supabase = createServiceRoleClient();

    const { data: plan } = await supabase
      .from("plans")
      .select("id, slug, name, price_usd")
      .eq("slug", parsed.data.planSlug)
      .eq("is_active", true)
      .maybeSingle();

    if (!plan) return { ok: false, message: "admin.grants.planNotFound" };

    const { data: target } = await supabase
      .from("profiles")
      .select("id, email")
      .eq("id", parsed.data.userId)
      .maybeSingle();

    if (!target) return { ok: false, message: "admin.users.detail.notFound" };

    const now = new Date();
    const end = new Date(now.getTime() + parsed.data.days * 24 * 60 * 60 * 1000);

    // Reuse the most recent subscription row rather than stacking a second
    // one: `getUserActivePlan` takes the newest billable row, so two live
    // rows would make which plan applies depend on ordering.
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id, billing_provider")
      .eq("user_id", target.id)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    // Never overwrite a real paid subscription with a grant — that would
    // silently detach a paying customer from their billing.
    if (existing && existing.billing_provider === "paystack") {
      return { ok: false, message: "admin.grants.hasPaidSubscription" };
    }

    const payload = {
      plan_id: plan.id,
      status: "active" as const,
      billing_provider: "manual",
      current_period_start: now.toISOString(),
      current_period_end: end.toISOString(),
      cancel_at_period_end: true,
      canceled_at: null,
      provider_reference: null,
    };

    const { error } = existing
      ? await supabase.from("subscriptions").update(payload).eq("id", existing.id)
      : await supabase.from("subscriptions").insert({ user_id: target.id, ...payload });

    // Tell the account holder. A plan that appears without explanation
    // reads as a billing error; the notification is what makes it a
    // deliberate gift with an end date they can plan around.
    if (!error) {
      await supabase.from("notifications").insert({
        user_id: target.id,
        type: "plan_granted",
        title: plan.name,
        body: null,
        metadata: {
          plan: plan.slug,
          planName: plan.name,
          days: parsed.data.days,
          expiresAt: end.toISOString(),
          reason: parsed.data.reason ?? null,
        },
      });
    }

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_granted",
      targetType: "user",
      targetId: target.id,
      result: error ? "failure" : "success",
      metadata: {
        plan: plan.slug,
        days: parsed.data.days,
        expiresAt: end.toISOString(),
        reason: parsed.data.reason ?? null,
      },
    });

    if (error) {
      logger.error("plan_grant_failed", { error: error.message });
      return { ok: false, message: "admin.grants.failed" };
    }

    await revalidateRegistry();
    revalidatePath(`/admin/users/${target.id}`);
    revalidatePath("/admin/users");
    revalidatePath("/moderator/users");
    return { ok: true, message: "admin.grants.granted" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("plan_grant_unexpected", { error: String(error) });
    return { ok: false, message: "admin.grants.failed" };
  }
}

const revokeSchema = z.object({ userId: z.string().uuid() });

/** Ends a complimentary grant early. Refuses to touch a paid subscription. */
export async function revokePlanGrantAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "subscriptions.grant");

    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.grants.invalid" };

    const supabase = createServiceRoleClient();
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("id, billing_provider")
      .eq("user_id", parsed.data.userId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!existing || existing.billing_provider !== "manual") {
      return { ok: false, message: "admin.grants.notAGrant" };
    }

    const { error } = await supabase
      .from("subscriptions")
      .update({ status: "canceled", canceled_at: new Date().toISOString() })
      .eq("id", existing.id);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.plan_grant_revoked",
      targetType: "user",
      targetId: parsed.data.userId,
      result: error ? "failure" : "success",
      metadata: {},
    });

    if (error) return { ok: false, message: "admin.grants.failed" };

    await revalidateRegistry();
    revalidatePath(`/admin/users/${parsed.data.userId}`);
    return { ok: true, message: "admin.grants.revoked" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("plan_grant_revoke_unexpected", { error: String(error) });
    return { ok: false, message: "admin.grants.failed" };
  }
}
