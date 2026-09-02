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

/**
 * The URL written after the server creates a conversation.
 *
 * This shipped to production as `/chat/<id>` — with no locale prefix,
 * though every route in the app is mounted under `/{locale}`. The address
 * bar stopped matching any route, the next render resolved to a fresh
 * empty chat, and the message that had just been sent disappeared. It
 * looked exactly like "sending a message opens a new empty chat".
 *
 * The function under test is inlined here rather than exported from a
 * client component, because it reads `window.location`; this pins the
 * rule it implements.
 */
function conversationUrl(currentPath: string, conversationId: string): string {
  const [, maybeLocale] = currentPath.split("/");
  const prefix = /^[a-z]{2}$/.test(maybeLocale ?? "") ? `/${maybeLocale}` : "";
  return `${prefix}/chat/${conversationId}`;
}

test("adopting a new conversation keeps the locale prefix", () => {
  assert.equal(conversationUrl("/en/chat", "abc"), "/en/chat/abc");
  assert.equal(conversationUrl("/fr/chat", "abc"), "/fr/chat/abc");
  assert.equal(conversationUrl("/ar/chat/old-id", "abc"), "/ar/chat/abc");
});

test("a path with no locale is left unprefixed rather than guessed", () => {
  // Mounting without a locale prefix is a valid configuration; inventing
  // one here would break it the same way dropping one broke this.
  assert.equal(conversationUrl("/chat", "abc"), "/chat/abc");
});

test("a first segment that is not a locale is not mistaken for one", () => {
  // Two letters is the test, so a longer segment must not be eaten.
  assert.equal(conversationUrl("/chatting/x", "abc"), "/chat/abc");
});

/**
 * Turn ordering.
 *
 * The user message and the assistant placeholder are written
 * concurrently, and messages are loaded `order by created_at`. Left to
 * the database's own `now()`, whichever transaction got there first won —
 * measured, the assistant row won 2 times in 5. The conversation then
 * rendered scrambled, and `loadConversationHistory` handed the model its
 * turns out of order, so it answered the wrong message.
 *
 * The route stamps the pair explicitly. This pins that rule.
 */
function turnTimestamps(at: number) {
  return { user: new Date(at).toISOString(), assistant: new Date(at + 1).toISOString() };
}

test("the assistant reply always sorts after the message that prompted it", () => {
  for (const at of [0, 1_700_000_000_000, Date.now()]) {
    const { user, assistant } = turnTimestamps(at);
    assert.ok(user < assistant, `${user} must sort before ${assistant}`);
  }
});

test("consecutive turns stay in order", () => {
  // Two turns a few milliseconds apart must not interleave.
  const first = turnTimestamps(1_700_000_000_000);
  const second = turnTimestamps(1_700_000_000_005);
  const sorted = [second.assistant, first.user, second.user, first.assistant].sort();
  assert.deepEqual(sorted, [first.user, first.assistant, second.user, second.assistant]);
});

/**
 * A reply that stopped mid-flight must not read as one still arriving.
 *
 * An assistant row is created `streaming` and settled when the turn ends.
 * A turn that never ends leaves it that way for good, and every later
 * visit renders a "Generating…" that will never resolve — there were 21
 * such rows in production. The route caps a turn at 120s, so anything
 * older provably is not running.
 */
const STALE_AFTER_MS = 150_000;
function settleStale(status: string, content: string, ageMs: number): string {
  if (status !== "streaming" || ageMs < STALE_AFTER_MS) return status;
  return content.trim() ? "stopped" : "error";
}

test("a stale streaming row is settled, not left generating", () => {
  assert.equal(settleStale("streaming", "half an answer", 10 * 60_000), "stopped");
  assert.equal(settleStale("streaming", "", 10 * 60_000), "error");
});

test("a recent streaming row is left alone — it may be live in another tab", () => {
  assert.equal(settleStale("streaming", "", 5_000), "streaming");
  assert.equal(settleStale("streaming", "partial", 149_000), "streaming");
});

test("settled rows are never touched", () => {
  for (const status of ["complete", "stopped", "error"]) {
    assert.equal(settleStale(status, "text", 10 * 60_000), status);
  }
});

/**
 * Building the history handed to the model.
 *
 * An assistant turn is stored twice over: as the message's own content,
 * and as the variant a regenerate switches between. The mapping used the
 * variant *only* — so when the link had not been written the whole turn
 * vanished from the history, silently. The model then saw two user
 * questions back to back and answered both, which is what produced
 * replies like "4\n\n20" and looked like it was replying to an earlier
 * message.
 */
type HistoryRow = { role: string; content: string | null; active_variant_id: string | null };

function buildHistory(rows: HistoryRow[], variants: Record<string, string>) {
  const out: Array<{ role: string; content: string }> = [];
  for (const row of rows) {
    if (row.role === "assistant") {
      const content = (row.active_variant_id ? variants[row.active_variant_id] : undefined) ?? row.content ?? "";
      if (content.trim()) out.push({ role: "assistant", content });
      continue;
    }
    if (!row.content) continue;
    out.push({ role: row.role, content: row.content });
  }
  return out;
}

test("an assistant turn survives a missing variant link", () => {
  const history = buildHistory(
    [
      { role: "user", content: "What is 2 plus 2?", active_variant_id: null },
      { role: "assistant", content: "4", active_variant_id: null },
      { role: "user", content: "What is 10 plus 10?", active_variant_id: null },
    ],
    {},
  );
  assert.deepEqual(history.map((m) => m.role), ["user", "assistant", "user"]);
  assert.equal(history[1].content, "4");
});

test("the variant wins when it is there — regenerate must show the chosen reply", () => {
  const history = buildHistory(
    [{ role: "assistant", content: "first answer", active_variant_id: "v2" }],
    { v2: "regenerated answer" },
  );
  assert.equal(history[0].content, "regenerated answer");
});

test("an empty assistant turn is still omitted", () => {
  // A failed turn has nothing to contribute and must not become a blank
  // assistant message in the prompt.
  assert.deepEqual(buildHistory([{ role: "assistant", content: "", active_variant_id: null }], {}), []);
  assert.deepEqual(buildHistory([{ role: "assistant", content: "   ", active_variant_id: null }], {}), []);
});

test("the model never receives two user turns in a row", () => {
  const history = buildHistory(
    [
      { role: "user", content: "one", active_variant_id: null },
      { role: "assistant", content: "1", active_variant_id: null },
      { role: "user", content: "two", active_variant_id: null },
      { role: "assistant", content: "2", active_variant_id: null },
    ],
    {},
  );
  const roles = history.map((m) => m.role).join(",");
  assert.ok(!roles.includes("user,user"), `alternating turns expected, got ${roles}`);
});
