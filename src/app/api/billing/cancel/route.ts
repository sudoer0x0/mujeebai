import { NextResponse } from "next/server";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { disableSubscription } from "@/billing/paystack";
import { recordAuditEvent } from "@/admin/audit";
import { logger } from "@/lib/logger";

// Self-service subscription cancellation.
export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: subscription } = await supabase
    .from("subscriptions")
    .select("*")
    .eq("user_id", user.id)
    .in("status", ["active", "trialing", "past_due"])
    .maybeSingle();

  if (!subscription) return NextResponse.json({ error: "No active subscription" }, { status: 404 });

  let disabledOnProvider = false;
  if (subscription.provider_subscription_code && subscription.provider_subscription_token) {
    try {
      await disableSubscription(
        subscription.provider_subscription_code,
        subscription.provider_subscription_token,
      );
      disabledOnProvider = true;
    } catch (error) {
      logger.warn("paystack_disable_subscription_failed", {
        subscriptionId: subscription.id,
        error: String(error),
      });
    }
  }

  await supabase
    .from("subscriptions")
    .update({
      cancel_at_period_end: true,
      canceled_at: new Date().toISOString(),
      status: disabledOnProvider ? "canceled" : subscription.status,
    })
    .eq("id", subscription.id);

  await recordAuditEvent({
    actorId: user.id,
    action: "billing.subscription_cancelled",
    targetType: "subscription",
    targetId: subscription.id,
    metadata: { disabledOnProvider },
  });

  return NextResponse.json({ ok: true, disabledOnProvider });
}
