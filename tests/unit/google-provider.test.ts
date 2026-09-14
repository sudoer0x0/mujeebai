import test from "node:test";
import assert from "node:assert/strict";
import { resolveGoogleModelId, googleChatAdapter, toGeminiContents } from "@/ai/providers/google";
import { googleImageAdapter } from "@/ai/providers/google-image";

test("resolveGoogleModelId maps model aliases correctly", () => {
  assert.equal(resolveGoogleModelId("gemini-3.5-flash-lite"), "gemini-3.5-flash-lite");
  assert.equal(resolveGoogleModelId("gemini-2.5-flash-lite"), "gemini-3.5-flash-lite");
  assert.equal(resolveGoogleModelId("fast"), "gemini-3.5-flash-lite");

  assert.equal(resolveGoogleModelId("gemini-3.6-flash"), "gemini-3.6-flash");
  assert.equal(resolveGoogleModelId("gemini-2.5-flash"), "gemini-3.6-flash");
  assert.equal(resolveGoogleModelId("think"), "gemini-3.6-flash");

  assert.equal(resolveGoogleModelId("custom-gemini-model"), "custom-gemini-model");
});

test("toGeminiContents merges consecutive same-role turns and filters empty inputs", () => {
  const result = toGeminiContents([
    { role: "system", content: "You are a helpful assistant." },
    { role: "user", content: "First question" },
    { role: "user", content: "Second part of question" },
    { role: "assistant", content: "Answer 1" },
    { role: "assistant", content: "Follow-up addition" },
    { role: "user", content: " " }, // whitespace should be filtered
    { role: "user", content: "Final prompt" },
  ]);

  assert.equal(result.systemInstruction, "You are a helpful assistant.");
  assert.equal(result.contents.length, 3);
  // First turn: merged user turns
  assert.equal(result.contents[0].role, "user");
  assert.equal(result.contents[0].parts.length, 2);
  assert.equal(result.contents[0].parts[0].text, "First question");
  assert.equal(result.contents[0].parts[1].text, "Second part of question");

  // Second turn: merged model turns
  assert.equal(result.contents[1].role, "model");
  assert.equal(result.contents[1].parts.length, 2);
  assert.equal(result.contents[1].parts[0].text, "Answer 1");
  assert.equal(result.contents[1].parts[1].text, "Follow-up addition");

  // Third turn: user turn (empty whitespace was dropped)
  assert.equal(result.contents[2].role, "user");
  assert.equal(result.contents[2].parts.length, 1);
  assert.equal(result.contents[2].parts[0].text, "Final prompt");
});

test("toGeminiContents ensures conversation starts with user and provides non-empty fallback", () => {
  // If only assistant message or empty
  const onlyAssistant = toGeminiContents([
    { role: "assistant", content: "Orphan assistant message" },
  ]);
  assert.ok(onlyAssistant.contents.length > 0);
  assert.equal(onlyAssistant.contents[0].role, "user");

  // If empty input
  const empty = toGeminiContents([]);
  assert.ok(empty.contents.length > 0);
  assert.equal(empty.contents[0].role, "user");
  assert.ok(empty.contents[0].parts[0].text?.length);
});

test("googleChatAdapter defines valid capabilities and slug", () => {
  assert.equal(googleChatAdapter.slug, "google");
  assert.ok(googleChatAdapter.capabilities.includes("text"));
  assert.ok(googleChatAdapter.capabilities.includes("vision"));
  assert.ok(googleChatAdapter.capabilities.includes("streaming"));
  assert.ok(googleChatAdapter.capabilities.includes("reasoning"));
  assert.ok(googleChatAdapter.capabilities.includes("audio"));
  assert.ok(googleChatAdapter.capabilities.includes("video"));
});

test("toGeminiContents converts base64 data URLs and media parts to inlineData", () => {
  const result = toGeminiContents([
    {
      role: "user",
      content: [
        { type: "text", text: "What is this?" },
        { type: "image_url", imageUrl: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" },
        {
          type: "media",
          media: {
            mimeType: "video/mp4",
            data: "AAAAHGZ0eXBtcDQyAAAAAG1wNDJtcDQx",
            filename: "clip.mp4",
          },
        },
        {
          type: "media",
          media: {
            mimeType: "application/pdf",
            data: "JVBERi0xLjQKJaqrrK4K",
            filename: "doc.pdf",
          },
        },
      ],
    },
  ]);

  assert.equal(result.contents.length, 1);
  const userTurn = result.contents[0];
  assert.equal(userTurn.role, "user");
  assert.equal(userTurn.parts.length, 4);
  assert.equal(userTurn.parts[0].text, "What is this?");
  assert.deepEqual(userTurn.parts[1].inlineData, {
    mimeType: "image/png",
    data: "iVBORw0KGgoAAAANSUhEUg==",
  });
  assert.deepEqual(userTurn.parts[2].inlineData, {
    mimeType: "video/mp4",
    data: "AAAAHGZ0eXBtcDQyAAAAAG1wNDJtcDQx",
  });
  assert.deepEqual(userTurn.parts[3].inlineData, {
    mimeType: "application/pdf",
    data: "JVBERi0xLjQKJaqrrK4K",
  });
});

test("googleImageAdapter defines valid slug", () => {
  assert.equal(googleImageAdapter.slug, "google-image");
});
