import test from "node:test";
import assert from "node:assert/strict";
import { hasMemoryCandidates, parseExtractedFacts } from "@/ai/memory/extractor";
import { formatMemoriesForPrompt } from "@/ai/memory/prompt";
import type { UserMemoryProfile } from "@/ai/memory/types";

test("hasMemoryCandidates correctly identifies personal and memory trigger phrases", () => {
  // Positive English triggers
  assert.equal(hasMemoryCandidates("Remember that I prefer strict TypeScript with no any"), true);
  assert.equal(hasMemoryCandidates("Keep in mind that my name is Tariq"), true);
  assert.equal(hasMemoryCandidates("I am a software architect at an AI startup"), true);
  assert.equal(hasMemoryCandidates("I work as a radiologist in London"), true);
  assert.equal(hasMemoryCandidates("Always use Tailwind CSS for UI components"), true);
  assert.equal(hasMemoryCandidates("Don't ever use var in JavaScript"), true);
  assert.equal(hasMemoryCandidates("We are building an e-commerce platform called Acme"), true);

  // Positive Multi-lingual triggers
  assert.equal(hasMemoryCandidates("تذكر أن مشروعي مبني على بايثون"), true);
  assert.equal(hasMemoryCandidates("اسمي أحمد وأعمل طبيباً في الرياض"), true);
  assert.equal(hasMemoryCandidates("Recuerda que prefiero respuestas concisas"), true);
  assert.equal(hasMemoryCandidates("Rappelle-toi que je travaille comme enseignant"), true);
  assert.equal(hasMemoryCandidates("记住我喜欢简洁的代码风格"), true);

  // Negative generic questions (should NOT trigger extraction)
  assert.equal(hasMemoryCandidates("What is the capital of Saudi Arabia?"), false);
  assert.equal(hasMemoryCandidates("Can you explain how async/await works in JavaScript?"), false);
  assert.equal(hasMemoryCandidates("Write a poem about the sunrise"), false);
  assert.equal(hasMemoryCandidates("How do I fix this null pointer exception?"), false);
  assert.equal(hasMemoryCandidates(""), false);
  assert.equal(hasMemoryCandidates("hi"), false);
});

test("parseExtractedFacts handles valid, fenced, and edge-case JSON outputs", () => {
  const plainJson = JSON.stringify([
    { category: "preference", content: "User prefers TypeScript with strict types" },
    { category: "project", content: "User is building an AI medical platform" },
    { category: "bio", content: "User's name is Tariq" },
  ]);

  const parsed = parseExtractedFacts(plainJson);
  assert.equal(parsed.length, 3);
  assert.equal(parsed[0].category, "preference");
  assert.equal(parsed[0].content, "User prefers TypeScript with strict types");
  assert.equal(parsed[1].category, "project");
  assert.equal(parsed[2].category, "bio");

  // Markdown code fence wrapped
  const fenced = "```json\n" + plainJson + "\n```";
  const parsedFenced = parseExtractedFacts(fenced);
  assert.equal(parsedFenced.length, 3);

  // Unrecognized category defaults to 'general'
  const unknownCat = JSON.stringify([
    { category: "super_secret_cat", content: "User lives in New York" },
  ]);
  const parsedUnknown = parseExtractedFacts(unknownCat);
  assert.equal(parsedUnknown[0].category, "general");

  // Invalid JSON returns empty array gracefully
  assert.deepEqual(parseExtractedFacts("Not JSON at all!"), []);
  assert.deepEqual(parseExtractedFacts("{}"), []);
});

test("formatMemoriesForPrompt formats memories when enabled and suppresses when disabled or empty", () => {
  const profileWithMemories: UserMemoryProfile = {
    enabled: true,
    memories: [
      {
        id: "1",
        userId: "user-1",
        category: "preference",
        content: "User prefers concise answers",
        createdAt: "2026-09-01T00:00:00Z",
        updatedAt: "2026-09-01T00:00:00Z",
      },
      {
        id: "2",
        userId: "user-1",
        category: "project",
        content: "User is building an educational portal",
        createdAt: "2026-09-02T00:00:00Z",
        updatedAt: "2026-09-02T00:00:00Z",
      },
    ],
  };

  // Enabled with memories => formats <user_memories> block
  const formatted = formatMemoriesForPrompt(profileWithMemories);
  assert.ok(formatted.includes("<user_memories>"));
  assert.ok(formatted.includes("User prefers concise answers"));
  assert.ok(formatted.includes("User is building an educational portal"));
  assert.ok(formatted.includes("</user_memories>"));

  // Disabled profile => returns empty string even if memories exist
  const disabledProfile: UserMemoryProfile = {
    ...profileWithMemories,
    enabled: false,
  };
  assert.equal(formatMemoriesForPrompt(disabledProfile), "");

  // Empty memories => returns empty string
  const emptyProfile: UserMemoryProfile = {
    enabled: true,
    memories: [],
  };
  assert.equal(formatMemoriesForPrompt(emptyProfile), "");
});

test("extractDeterministicFacts accurately captures immediate name declarations", () => {
  const { extractDeterministicFacts } = require("@/ai/memory/extractor");

  // English "my name is..."
  const facts1 = extractDeterministicFacts("my name is mujeeb keep that in your memory incase i ask");
  assert.equal(facts1.length, 1);
  assert.equal(facts1[0].category, "bio");
  assert.equal(facts1[0].content, "User's name is Mujeeb");

  // English "call me..."
  const facts2 = extractDeterministicFacts("Please call me Tariq for our discussions");
  assert.equal(facts2.length, 1);
  assert.equal(facts2[0].content, "User's name is Tariq");

  // Arabic "اسمي..."
  const facts3 = extractDeterministicFacts("مرحبا، اسمي فيصل وسنعمل على مشروع جديد");
  assert.equal(facts3.length, 1);
  assert.equal(facts3[0].content, "User's name is فيصل");

  // Spanish "me llamo..."
  const facts4 = extractDeterministicFacts("Hola me llamo Carlos");
  assert.equal(facts4.length, 1);
  assert.equal(facts4[0].content, "User's name is Carlos");

  // Assistant naming: "i want to name you yung so keep that in your memory"
  const facts5 = extractDeterministicFacts("i want to name you yung so keep that in your memory");
  assert.ok(facts5.some((f: any) => f.content === "User wants the assistant to be named Yung"));

  // Profession and occupation
  const facts6 = extractDeterministicFacts("I work as a software engineer at a startup");
  assert.ok(facts6.some((f: any) => f.content.includes("software engineer")));

  // Location / residence
  const facts7 = extractDeterministicFacts("I live in Lagos and work remotely");
  assert.ok(facts7.some((f: any) => f.content.includes("Lagos")));

  // Behavioral preferences
  const facts8 = extractDeterministicFacts("always reply in concise bullet points");
  assert.ok(facts8.some((f: any) => f.content.includes("concise bullet points")));

  // Non-name declarations should return empty array
  assert.deepEqual(extractDeterministicFacts("What is the weather today?"), []);
  assert.deepEqual(extractDeterministicFacts(""), []);
});


