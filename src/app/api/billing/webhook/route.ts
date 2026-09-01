import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { verifyWebhookSignature } from "@/billing/paystack";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { recordAuditEvent } from "@/admin/audit";

export const runtime = "nodejs";

/**
 * Paystack webhook receiver.
 *
 * A signed payload is authentic, not necessarily *shaped the way we
 * expect*, so the body is validated too — a validly-signed but
 * unexpectedly-shaped event (a future Paystack API change, say) is
 * rejected with a clean 400 rather than producing a half-written
 * subscription.
 */
const paystackEventSchema = z.object({
  event: z.string(),
  data: z.object({
    id: z.union([z.number(), z.string()]).optional(),
    reference: z.string().optional(),
    status: z.string().optional(),
    amount: z.number().optional(),
    currency: z.string().optional(),
    subscription_code: z.string().optional(),
    email_token: z.string().optional(),
    customer: z
      .object({ email: z.string().email().optional(), customer_code: z.string().optional() })
      .optional(),
    plan: z.object({ plan_code: z.string().optional() }).optional(),
    metadata: z
      .object({ userId: z.string().uuid().optional(), planId: z.string().uuid().optional() })
      .optional(),
    next_payment_date: z.string().optional(),
    paid_at: z.string().optional(),
    created_at: z.string().optional(),
  }),
});

type PaystackEvent = z.infer<typeof paystackEventSchema>;
type ServiceClient = ReturnType<typeof createServiceRoleClient>;

async function findUserIdByEmail(supabase: ServiceClient, email: string) {
  const { data } = await supabase.from("profiles").select("id").eq("email", email.toLowerCase()).maybeSingle();
  return data?.id ?? null;
}

/**
 * Resolves the plan a renewal belongs to.
 *
 * Renewal charges carry no `metadata` (that only rides along on the
 * checkout we initiated), so the plan has to be recovered from the
 * subscription's Paystack plan code, then from the user's existing
 * subscription. Without this, every renewal after the first was recorded
 * as a payment but never extended the period, and the subscription
 * silently expired while the customer kept being billed.
 */
async function resolvePlanId(
  supabase: ServiceClient,
  event: PaystackEvent,
  userId: string | null,
): Promise<string | null> {
  if (event.data.metadata?.planId) return event.data.metadata.planId;

  const planCode = event.data.plan?.plan_code;
  if (planCode) {
    const { data: plans } = await supabase.from("plans").select("id, metadata");
    const match = (plans ?? []).find(
      (plan) => (plan.metadata as Record<string, unknown> | null)?.paystack_plan_code === planCode,
    );
    if (match) return match.id;
  }

  if (userId) {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("plan_id")
      .eq("user_id", userId)
      .in("status", ["active", "trialing", "past_due"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (existing) return existing.plan_id;
  }

  return null;
}

/** The subscription row we should be updating for a user, if any. */
async function findLiveSubscription(supabase: ServiceClient, userId: string) {
  // Ordered + limited rather than `.maybeSingle()` on a bare user filter:
  // a user who has cancelled and resubscribed has more than one row, and
  // maybeSingle() *errors* on multiple matches — which the previous
  // handler swallowed, so the new subscription was never activated.
  const { data } = await supabase
    .from("subscriptions")
    .select("id, status")
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-paystack-signature");

  // Signature first, always, against the raw body — never a re-serialized
  // JSON round trip, which would not match the HMAC.
  if (!verifyWebhookSignature(rawBody, signature)) {
    logger.warn("paystack_webhook_invalid_signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
  }

  let event: PaystackEvent;
  try {
    const parsed = paystackEventSchema.safeParse(JSON.parse(rawBody));
    if (!parsed.success) {
      logger.warn("paystack_webhook_unexpected_shape", { error: parsed.error.message });
      return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
    }
    event = parsed.data;
  } catch {
    return NextResponse.json({ error: "Invalid payload" }, { status: 400 });
  }

  const supabase = createServiceRoleClient();

  try {
    switch (event.event) {
      case "charge.success": {
        const { reference, amount, currency, customer, metadata } = event.data;
        if (!reference) break;

        // Idempotency: `payment_records` has a unique index on
        // (provider, provider_reference), so a redelivered event is a
        // no-op rather than a double activation.
        const { data: existingPayment } = await supabase
          .from("payment_records")
          .select("id")
          .eq("provider", "paystack")
          .eq("provider_reference", reference)
          .maybeSingle();
        if (existingPayment) {
          logger.debug("paystack_webhook_duplicate_ignored", { event: event.event });
          break;
        }

        const userId =
          metadata?.userId ?? (customer?.email ? await findUserIdByEmail(supabase, customer.email) : null);

        const { error: paymentError } = await supabase.from("payment_records").insert({
          user_id: userId,
          provider: "paystack",
          provider_reference: reference,
          amount: amount ? amount / 100 : null,
          currency: currency ?? null,
          status: "success",
          raw_event: event as never,
        });

        // A failure to record the payment is genuinely retriable: return
        // non-2xx so Paystack redelivers rather than dropping the charge.
        if (paymentError) throw new Error(`payment_records insert failed: ${paymentError.message}`);

        if (!userId) {
          // Recorded but unattributable — surface it rather than silently
          // taking money with no subscription attached.
          logger.error("paystack_charge_without_user", { reference });
          break;
        }

        const planId = await resolvePlanId(supabase, event, userId);
        if (!planId) {
          logger.error("paystack_charge_without_plan", { reference });
          break;
        }

        const { data: plan } = await supabase
          .from("plans")
          .select("slug, name")
          .eq("id", planId)
          .maybeSingle();

        const now = new Date();
        const periodEnd = new Date(now);
        periodEnd.setMonth(periodEnd.getMonth() + 1);

        const existing = await findLiveSubscription(supabase, userId);

        const payload = {
          plan_id: planId,
          status: "active" as const,
          provider_reference: reference,
          currency: currency ?? "USD",
          current_period_start: now.toISOString(),
          current_period_end: periodEnd.toISOString(),
          cancel_at_period_end: false,
          canceled_at: null,
        };

        const { error: subscriptionError } = existing
          ? await supabase.from("subscriptions").update(payload).eq("id", existing.id)
          : await supabase
              .from("subscriptions")
              .insert({ user_id: userId, billing_provider: "paystack", ...payload });

        if (subscriptionError) throw new Error(`subscription upsert failed: ${subscriptionError.message}`);

        // Confirm the purchase in the product, not only by email. A
        // payment that changes nothing visible is the most common reason
        // someone contacts support after paying.
        await supabase.from("notifications").insert({
          user_id: userId,
          type: "plan_purchased",
          title: plan?.name ?? "",
          body: null,
          metadata: {
            plan: plan?.slug ?? null,
            planName: plan?.name ?? null,
            expiresAt: periodEnd.toISOString(),
          },
        });

        await recordAuditEvent({
          actorId: null,
          action: "billing.subscription_activated",
          targetType: "user",
          targetId: userId,
          metadata: { reference, planId },
        });
        break;
      }

      case "subscription.create": {
        const { subscription_code, email_token, customer, plan } = event.data;
        if (!customer?.email) break;

        const userId = await findUserIdByEmail(supabase, customer.email);
        if (!userId) break;

        const existing = await findLiveSubscription(supabase, userId);

        // Paystack can deliver subscription.create *before* charge.success.
        // Writing the tokens onto a row that does not exist yet used to
        // lose them silently, which then made self-service cancellation
        // impossible (it needs both the code and the email token).
        if (!existing) {
          logger.warn("paystack_subscription_create_before_charge", { userId });
          break;
        }

        const { error } = await supabase
          .from("subscriptions")
          .update({
            provider_subscription_code: subscription_code ?? null,
            provider_subscription_token: email_token ?? null,
            provider_customer_id: customer.customer_code ?? null,
            status: "active",
          })
          .eq("id", existing.id);

        if (error) throw new Error(`subscription.create update failed: ${error.message}`);

        await recordAuditEvent({
          actorId: null,
          action: "billing.subscription_created",
          targetType: "user",
          targetId: userId,
          metadata: { planCode: plan?.plan_code ?? null },
        });
        break;
      }

      case "subscription.not_renew":
      case "subscription.disable": {
        const { subscription_code } = event.data;
        if (!subscription_code) break;

        // `not_renew` means "will lapse at period end", `disable` means
        // "off now" — collapsing both to canceled would cut access short
        // for a period the customer already paid for.
        const update =
          event.event === "subscription.not_renew"
            ? { cancel_at_period_end: true, canceled_at: new Date().toISOString() }
            : { status: "canceled" as const, canceled_at: new Date().toISOString() };

        const { error } = await supabase
          .from("subscriptions")
          .update(update)
          .eq("provider_subscription_code", subscription_code);

        if (error) throw new Error(`subscription cancel update failed: ${error.message}`);
        break;
      }

      case "invoice.payment_failed": {
        const { subscription_code } = event.data;
        if (!subscription_code) break;
        const { error } = await supabase
          .from("subscriptions")
          .update({ status: "past_due" })
          .eq("provider_subscription_code", subscription_code);
        if (error) throw new Error(`past_due update failed: ${error.message}`);
        break;
      }

      default:
        logger.debug("paystack_webhook_unhandled_event", { event: event.event });
    }
  } catch (error) {
    // Returning 200 here — which this handler used to do unconditionally —
    // tells Paystack the event was handled and stops redelivery, so a
    // transient database failure silently loses a customer's payment.
    // Non-2xx lets Paystack's retry schedule do its job; the idempotency
    // check above makes redelivery safe.
    logger.error("paystack_webhook_processing_failed", { event: event.event, error: String(error) });
    return NextResponse.json({ error: "Processing failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
