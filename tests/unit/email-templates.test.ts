import test from "node:test";
import assert from "node:assert/strict";
import { buildPlanGrantedEmail } from "@/notifications/templates/plan-granted";

test("buildPlanGrantedEmail generates valid email with correct subject, body and RTL support", () => {
  const email = buildPlanGrantedEmail({
    to: "user@example.com",
    locale: "en",
    displayName: "Jane Doe",
    planName: "Pro Tier",
    days: 45,
    expiresAt: "2026-10-15T00:00:00.000Z",
    reason: "Thanks for early feedback!",
  });

  assert.equal(email.to, "user@example.com");
  assert.equal(email.tag, "plan_granted");
  assert.ok(email.subject.includes("Pro Tier"));
  assert.ok(email.html.includes("Jane Doe"));
  assert.ok(email.html.includes("Pro Tier"));
  assert.ok(email.html.includes("45 days"));
  assert.ok(email.html.includes("Thanks for early feedback!"));
  assert.ok(email.text.includes("45 days"));
  assert.ok(email.text.includes("Thanks for early feedback!"));
  assert.ok(email.html.includes('dir="ltr"'));
});

test("buildPlanGrantedEmail sets RTL direction for Arabic locale", () => {
  const email = buildPlanGrantedEmail({
    to: "arabic@example.com",
    locale: "ar",
    planName: "Pro Tier",
    days: 30,
    expiresAt: "2026-10-01T00:00:00.000Z",
  });

  assert.ok(email.html.includes('dir="rtl"'));
});
