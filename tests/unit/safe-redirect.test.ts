import test from "node:test";
import assert from "node:assert/strict";
import { safeNextPath } from "@/lib/safe-redirect";

test("safeNextPath keeps ordinary same-origin paths", () => {
  assert.equal(safeNextPath("/chat"), "/chat");
  assert.equal(safeNextPath("/admin/users?q=a%40b.com"), "/admin/users?q=a%40b.com");
  assert.equal(safeNextPath("/settings#billing"), "/settings#billing");
});

test("safeNextPath falls back for empty input", () => {
  assert.equal(safeNextPath(null), "/");
  assert.equal(safeNextPath(undefined, "/chat"), "/chat");
  assert.equal(safeNextPath("", "/chat"), "/chat");
});

test("safeNextPath rejects anything that could leave the origin", () => {
  const hostile = [
    "//evil.com",
    "///evil.com",
    "https://evil.com",
    "http://evil.com/path",
    "//evil.com/path",
    "/\\evil.com",
    "/\\/evil.com",
    "javascript:alert(1)",
    "chat",
    "../admin",
  ];

  for (const value of hostile) {
    assert.equal(safeNextPath(value, "/chat"), "/chat", `expected ${value} to be rejected`);
  }
});

test("safeNextPath strips control characters used to smuggle a scheme", () => {
  // Browsers ignore these when resolving a URL, so a naive
  // startsWith("//") check passes while the redirect still leaves the
  // origin. Every one of these must fall back.
  const smuggled = [
    "\n//evil.com",
    "\t//evil.com",
    "\r\n//evil.com",
    " //evil.com",
    "\u0000//evil.com",
    "\u000b//evil.com",
    "\u000c//evil.com",
    "ht\ntps://evil.com",
  ];

  for (const value of smuggled) {
    assert.equal(safeNextPath(value, "/chat"), "/chat", `expected ${JSON.stringify(value)} to be rejected`);
  }
});
