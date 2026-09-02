import test from "node:test";
import assert from "node:assert/strict";
import { displayContentOf, activeVariantIndexOf } from "@/components/chat/types";
import type { UiMessage, UiMessageVariant } from "@/components/chat/types";

function variant(id: string, content: string): UiMessageVariant {
  return { id, content, sequence: 1, reasoning_summary: null, finish_reason: null, error: null };
}

function assistant(partial: Partial<UiMessage>): UiMessage {
  return {
    id: "m1",
    role: "assistant",
    content: "",
    status: "complete",
    ...partial,
  } as UiMessage;
}

/**
 * The bug this guards shipped to production.
 *
 * A fresh reply creates a variant row with `content: ""`. The renderer
 * resolved text as `activeVariant?.content ?? message.content` — and an
 * empty string is not nullish, so `??` never fell through. The reply
 * streamed into `message.content` while the screen rendered the empty
 * variant, and only appeared after a reload, when the server sent the
 * variant already filled in.
 */
test("an empty variant does not hide the message content", () => {
  const message = assistant({
    content: "the streamed reply",
    variants: [variant("v1", "")],
  });
  assert.equal(displayContentOf(message), "the streamed reply");
});

test("a filled variant wins over the message content", () => {
  // Regenerate writes alternatives into variants; the chosen one is what
  // the reader picked and must be shown.
  const message = assistant({
    content: "first answer",
    variants: [variant("v1", "first answer"), variant("v2", "second answer")],
    activeVariantIndex: 1,
  });
  assert.equal(displayContentOf(message), "second answer");
});

test("with no variants the message content is shown", () => {
  assert.equal(displayContentOf(assistant({ content: "plain" })), "plain");
  assert.equal(displayContentOf(assistant({ content: "" })), "");
});

test("the renderer and the streaming updater agree on the active variant", () => {
  // They did not, which is how the text ended up somewhere nothing read.
  // With no explicit index the last variant is active, for both.
  const noIndex = assistant({ variants: [variant("v1", "a"), variant("v2", "b")] });
  assert.equal(activeVariantIndexOf(noIndex), 1);
  assert.equal(displayContentOf(noIndex), "b");

  const explicit = assistant({
    variants: [variant("v1", "a"), variant("v2", "b")],
    activeVariantIndex: 0,
  });
  assert.equal(activeVariantIndexOf(explicit), 0);
  assert.equal(displayContentOf(explicit), "a");

  assert.equal(activeVariantIndexOf(assistant({})), null);
  // An index pointing past the end must not resolve to a phantom variant.
  assert.equal(activeVariantIndexOf(assistant({ variants: [], activeVariantIndex: 3 })), null);
});

test("a user message always shows its own content", () => {
  const message = { ...assistant({ content: "hello" }), role: "user" } as UiMessage;
  assert.equal(displayContentOf(message), "hello");
});
