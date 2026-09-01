import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyWebhookSignature } from "@/billing/paystack";

test("paystack webhook: verifyWebhookSignature validates correct HMAC-SHA512", () => {
  const secret = "test_secret_key_12345";
  const payload = JSON.stringify({
    event: "charge.success",
    data: { reference: "ref_123", amount: 5000, currency: "USD" },
  });

  const validSignature = crypto.createHmac("sha512", secret).update(payload).digest("hex");

  assert.equal(verifyWebhookSignature(payload, validSignature, secret), true);
});

test("paystack webhook: verifyWebhookSignature rejects invalid, tampered or missing signatures", () => {
  const secret = "test_secret_key_12345";
  const payload = JSON.stringify({ event: "charge.success", data: { reference: "ref_123" } });
  const validSignature = crypto.createHmac("sha512", secret).update(payload).digest("hex");

  // Missing header
  assert.equal(verifyWebhookSignature(payload, null, secret), false);

  // Tampered payload
  const tamperedPayload = JSON.stringify({ event: "charge.success", data: { reference: "ref_999" } });
  assert.equal(verifyWebhookSignature(tamperedPayload, validSignature, secret), false);

  // Tampered signature
  const badSignature = "deadbeef" + validSignature.slice(8);
  assert.equal(verifyWebhookSignature(payload, badSignature, secret), false);
});
