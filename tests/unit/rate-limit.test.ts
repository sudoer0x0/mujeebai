import test from "node:test";
import assert from "node:assert/strict";
import { checkRateLimit } from "@/lib/rate-limit";

test("rate limiter: allows requests within threshold and blocks excess", () => {
  const testKey = `test_user_${Date.now()}`;
  const limit = 3;
  const windowMs = 5000;

  // First 3 should pass
  const r1 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r1.allowed, true);
  assert.equal(r1.remaining, 2);

  const r2 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r2.allowed, true);
  assert.equal(r2.remaining, 1);

  const r3 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r3.allowed, true);
  assert.equal(r3.remaining, 0);

  // 4th should be blocked
  const r4 = checkRateLimit(testKey, limit, windowMs);
  assert.equal(r4.allowed, false);
  assert.equal(r4.remaining, 0);
});

test("rate limiter: isolates different keys", () => {
  const keyA = `user_a_${Date.now()}`;
  const keyB = `user_b_${Date.now()}`;

  const rA1 = checkRateLimit(keyA, 1, 5000);
  assert.equal(rA1.allowed, true);

  const rA2 = checkRateLimit(keyA, 1, 5000);
  assert.equal(rA2.allowed, false);

  // Key B should still be allowed
  const rB1 = checkRateLimit(keyB, 1, 5000);
  assert.equal(rB1.allowed, true);
});
