import test from "node:test";
import assert from "node:assert/strict";
import { wrapUntrustedDocument } from "@/files/processors/index";

test("prompt injection: wrapUntrustedDocument encloses content with nonces", () => {
  const filename = "user_input.pdf";
  const content = "Normal extracted text from user document";
  const nonce = "custom_nonce_123";

  const wrapped = wrapUntrustedDocument(filename, content, nonce);

  assert.match(wrapped, /<<<ATTACHED_DOCUMENT filename="user_input\.pdf" nonce="custom_nonce_123"/);
  assert.match(wrapped, /<<<END_ATTACHED_DOCUMENT nonce="custom_nonce_123">>>/);
  assert.ok(wrapped.includes(content));
});

test("prompt injection: wrapUntrustedDocument generates random nonce when not supplied", () => {
  const content = "Some text";
  const wrapped1 = wrapUntrustedDocument("doc1.txt", content);
  const wrapped2 = wrapUntrustedDocument("doc2.txt", content);

  // Both should contain nonce markers
  assert.match(wrapped1, /nonce="[a-zA-Z0-9_-]{12}"/);
  assert.match(wrapped2, /nonce="[a-zA-Z0-9_-]{12}"/);

  // Random nonces should differ
  assert.notEqual(wrapped1, wrapped2);
});

test("prompt injection: wrapUntrustedDocument sanitizes malicious filenames", () => {
  const dirtyFilename = 'malicious" filename\r\nwith_breaks.txt';
  const wrapped = wrapUntrustedDocument(dirtyFilename, "safe text", "nonce123");

  assert.ok(!wrapped.includes('filename="malicious"'));
  assert.ok(!wrapped.includes("\r\nwith_breaks"));
});
