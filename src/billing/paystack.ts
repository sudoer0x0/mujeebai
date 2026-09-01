import "server-only";
import crypto from "node:crypto";
import { providerStatus, paystackSigningSecret, serverEnv } from "@/lib/env.server";
import { logger } from "@/lib/logger";

// Paystack REST API billing adapter.
const PAYSTACK_BASE_URL = "https://api.paystack.co";

export class PaystackNotConfiguredError extends Error {
  constructor() {
    super("Paystack is not configured on this deployment.");
  }
}

function requireSecretKey() {
  if (!providerStatus.paystack || !serverEnv.PAYSTACK_SECRET_KEY) throw new PaystackNotConfiguredError();
  return serverEnv.PAYSTACK_SECRET_KEY;
}

async function paystackFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const secretKey = requireSecretKey();
  const response = await fetch(`${PAYSTACK_BASE_URL}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${secretKey}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });

  const json = await response.json().catch(() => null);
  if (!response.ok || !json?.status) {
    logger.error("paystack_api_error", { path, status: response.status, message: json?.message });
    throw new Error(json?.message ?? `Paystack request to ${path} failed (${response.status})`);
  }
  return json.data as T;
}

export interface InitializeTransactionParams {
  email: string;
  amountMinorUnits: number; // kobo for NGN, cents for USD, etc.
  currency: string;
  reference: string;
  planCode?: string;
  callbackUrl: string;
  metadata?: Record<string, unknown>;
}

export async function initializeTransaction(params: InitializeTransactionParams) {
  return paystackFetch<{ authorization_url: string; access_code: string; reference: string }>(
    "/transaction/initialize",
    {
      method: "POST",
      body: JSON.stringify({
        email: params.email,
        amount: params.amountMinorUnits,
        currency: params.currency,
        reference: params.reference,
        plan: params.planCode,
        callback_url: params.callbackUrl,
        metadata: params.metadata,
      }),
    },
  );
}

export async function verifyTransaction(reference: string) {
  return paystackFetch<{
    status: string;
    reference: string;
    amount: number;
    currency: string;
    customer: { email: string; customer_code: string };
    plan?: { plan_code: string };
    authorization?: { authorization_code: string };
  }>(`/transaction/verify/${encodeURIComponent(reference)}`);
}

export async function disableSubscription(subscriptionCode: string, emailToken: string) {
  return paystackFetch("/subscription/disable", {
    method: "POST",
    body: JSON.stringify({ code: subscriptionCode, token: emailToken }),
  });
}

/**
 * Verifies the `x-paystack-signature` header (HMAC-SHA512 of the raw body
 * with the webhook secret) before any webhook event is trusted (master
 * spec #40). Must be called with the *raw* request body string/buffer,
 * never a re-serialized JSON.parse(...) round trip.
 */
export function verifyWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  secret?: string,
): boolean {
  // Falls back to the Paystack secret key, which is what Paystack
  // actually signs with — see the note on PAYSTACK_WEBHOOK_SECRET in
  // src/lib/env.server.ts.
  const webhookSecret = secret ?? paystackSigningSecret();
  if (!signatureHeader || !webhookSecret) return false;
  const expected = crypto
    .createHmac("sha512", webhookSecret)
    .update(rawBody)
    .digest("hex");
  try {
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signatureHeader));
  } catch {
    return false; // length mismatch etc — treat as invalid, never throw here
  }
}
