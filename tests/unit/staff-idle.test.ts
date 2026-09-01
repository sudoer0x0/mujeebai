import test from "node:test";
import assert from "node:assert/strict";
import { isStaffSessionIdle, STAFF_IDLE_TIMEOUT_MS } from "@/auth/staff-idle";

const NOW = 1_800_000_000_000;

test("a fresh marker is not idle", () => {
  assert.equal(isStaffSessionIdle(String(NOW), NOW), false);
  assert.equal(isStaffSessionIdle(String(NOW - 60_000), NOW), false);
});

test("the cut-off is five minutes", () => {
  // Exactly at the boundary is still allowed; past it is not.
  assert.equal(isStaffSessionIdle(String(NOW - STAFF_IDLE_TIMEOUT_MS), NOW), false);
  assert.equal(isStaffSessionIdle(String(NOW - STAFF_IDLE_TIMEOUT_MS - 1), NOW), true);
  assert.equal(STAFF_IDLE_TIMEOUT_MS, 5 * 60 * 1000);
});

test("a missing marker is treated as fresh, not expired", () => {
  // The first staff request of a session has no cookie yet. Reading that
  // as "idle" would make signing in impossible.
  assert.equal(isStaffSessionIdle(undefined, NOW), false);
});

test("a malformed marker cannot be used to force anyone out", () => {
  // The cookie is httpOnly, but a corrupted or crafted value must fail
  // toward keeping the operator working rather than ejecting them.
  for (const bad of ["", "abc", "-1", "0", "NaN", "Infinity", "1e999"]) {
    assert.equal(isStaffSessionIdle(bad, NOW), false, `"${bad}" must not read as idle`);
  }
});

test("a future timestamp is not trusted to extend a session", () => {
  // Clock skew, or tampering that somehow got past httpOnly. Treating a
  // far-future value as valid would extend the session indefinitely; it
  // is clamped to "not idle now" and re-stamped on the next request.
  assert.equal(isStaffSessionIdle(String(NOW + 60 * 60_000), NOW), false);
});
