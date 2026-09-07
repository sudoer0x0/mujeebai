import "server-only";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { getUserMemoryProfile, addUserMemory } from "./store";
import type { UserMemoryCategory } from "./types";

/**
 * Fast regex pre-filter to detect whether a user message potentially
 * contains personal facts, preferences, constraints, or instructions.
 * Skips LLM extraction for purely generic/factual queries.
 */
export function hasMemoryCandidates(text: string): boolean {
  if (!text || text.length < 3) return false;
  const lower = text.toLowerCase();

  // Explicit memory / storage / reminder keywords across languages
  if (
    lower.includes("memory") ||
    lower.includes("remember") ||
    lower.includes("keep in mind") ||
    lower.includes("note that") ||
    lower.includes("don't forget") ||
    lower.includes("dont forget") ||
    lower.includes("save this") ||
    lower.includes("store this") ||
    lower.includes("تذكر") ||
    lower.includes("احفظ") ||
    lower.includes("ذاكرة") ||
    lower.includes("recuerda") ||
    lower.includes("guarda") ||
    lower.includes("mémoire") ||
    lower.includes("rappelle") ||
    lower.includes("lembre") ||
    lower.includes("记住") ||
    lower.includes("覚えて")
  ) {
    return true;
  }

  // Personal preferences, identity, traits & assistant naming
  const personalPatterns = [
    /\b(i prefer|i like|i love|i hate|i usually|i always|i never)\b/,
    /\b(call me|name me|my name is|my nickname is)\b/,
    /\b(name you|call you|your name is|i will call you|call yourself)\b/,
    /\b(i am a|i am an|i'm a|i'm an|i work as|i work at|i work in|i live in|i am based in|my job is)\b/,
    /\b(i am building|we are building|my project is|my stack is|my company is)\b/,
    /\b(always use|never use|don't ever use|avoid using|from now on)\b/,
    /(اسمي|أنا أعمل|أنا أفضل|أفضل استخدام|مشروعي هو|نحن نطور|سميتك|اسمك هو|نادني)/,
    /(me llamo|mi nombre es|prefiero|siempre usa|no uses|te llamo)/,
    /(je m'appelle|je préfère|je travaille comme|utilise toujours|je te nomme)/,
  ];

  return personalPatterns.some((pattern) => pattern.test(lower));
}

export interface ExtractedFact {
  category: UserMemoryCategory;
  content: string;
}

/**
 * Parses raw LLM output into structured memory facts.
 */
export function parseExtractedFacts(rawJson: string): ExtractedFact[] {
  try {
    const cleaned = rawJson
      .trim()
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/, "")
      .trim();

    const parsed = JSON.parse(cleaned);
    const validCategories: Set<string> = new Set(["preference", "bio", "project", "constraint", "general"]);

    // Handle array format: [{"category": "...", "content": "..."}]
    if (Array.isArray(parsed)) {
      return parsed
        .filter((item) => item && typeof item.content === "string" && item.content.trim().length > 3)
        .map((item) => ({
          category: validCategories.has(item.category) ? (item.category as UserMemoryCategory) : "general",
          content: String(item.content).trim(),
        }));
    }

    // Handle wrapper object format: {"memory": [...]} or {"memories": [...]}
    if (parsed && typeof parsed === "object") {
      const list = (parsed as Record<string, unknown>).memory || (parsed as Record<string, unknown>).memories;
      if (Array.isArray(list)) {
        return list
          .filter((item) => item && typeof item.content === "string" && item.content.trim().length > 3)
          .map((item) => ({
            category: validCategories.has(item.category) ? (item.category as UserMemoryCategory) : "general",
            content: String(item.content).trim(),
          }));
      }
    }

    return [];
  } catch {
    return [];
  }
}

/**
 * Fast deterministic extractor for unambiguous declarations:
 * 1. Assistant naming / persona directives ("name you X", "your name is X")
 * 2. User name and nicknames ("my name is X", "call me X", "اسمي X")
 * 3. User profession / occupation ("i am a software engineer", "i work as a doctor")
 * 4. User location / residence ("i live in Lagos", "i am based in Riyadh")
 * 5. Formatting / behavior rules ("always reply in bullet points", "never use python 2")
 *
 * Runs locally with 0ms latency and zero external API dependencies.
 */
export function extractDeterministicFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  if (!text || text.length < 4) return facts;

  // 1. Assistant naming / persona directives
  // e.g. "i want to name you yung so keep that in your memory", "your name is yung"
  const assistantNamePatterns = [
    /(?:^|[.!?\n,]|(?:keep in mind that|remember that|note that)\s+)?(?:i\s+(?:want|would like)\s+to\s+name\s+you|name\s+you|your\s+name\s+is|i\s+will\s+call\s+you|i'll\s+call\s+you|call\s+yourself)\s+([A-Za-z0-9\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,])?(?:سميتك|أريد أن أسميك|اسمك هو|سأناديك)\s+([A-Za-z0-9\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,])?(?:te llamo|tu nombre es|quiero llamarte)\s+([A-Za-z0-9\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,])?(?:je te nomme|ton nom est|je vais t'appeler)\s+([A-Za-z0-9\u0600-\u06FF'-]+)/i,
  ];
  for (const pattern of assistantNamePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const raw = match[1].trim();
      if (raw.length >= 2 && !/^(a|an|the|this|that|not|very|just|so)$/i.test(raw)) {
        const formatted = raw.charAt(0).toUpperCase() + raw.slice(1);
        facts.push({
          category: "preference",
          content: `User wants the assistant to be named ${formatted}`,
        });
        break;
      }
    }
  }

  // 2. User name matchers
  // e.g. "my name is X", "call me X", "اسمي X"
  const userNamePatterns = [
    /(?:^|[.!?\n,]|(?:keep in mind that|remember that|note that)\s+)?(?:my name is|call me|you can call me|my nickname is)\s+([A-Za-z\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,]|(?:تذكر أن|احفظ عندك)\s+)?(?:اسمي|نادني|اسمي هو)\s+([A-Za-z\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,])?(?:me llamo|mi nombre es|llámame)\s+([A-Za-z\u0600-\u06FF'-]+)/i,
    /(?:^|[.!?\n,])?(?:je m'appelle|mon nom est|appelle-moi)\s+([A-Za-z\u0600-\u06FF'-]+)/i,
  ];
  for (const pattern of userNamePatterns) {
    const match = text.match(pattern);
    if (match && match[1]) {
      const rawName = match[1].trim();
      if (rawName.length >= 2 && !/^(not|a|an|the|very|always|just|you)$/i.test(rawName)) {
        const formattedName = rawName.charAt(0).toUpperCase() + rawName.slice(1);
        facts.push({
          category: "bio",
          content: `User's name is ${formattedName}`,
        });
        break;
      }
    }
  }

  // 3. User profession / occupation
  // e.g. "i am a software engineer", "also i am a software engineer", "i work as a doctor"
  const occupationPattern =
    /(?:^|[.!?\n,])\s*(?:(?:also|and|plus|actually|by the way)\s+)?(?:i\s+am\s+(?:a|an)|i'm\s+(?:a|an)|i\s+work\s+as\s+(?:a|an))\s+([a-zA-Z\s]{3,35}?)(?=[.,;!?]|$|\band\b|\bwho\b|\bbased\b|\bliving\b)/i;
  const occMatch = text.match(occupationPattern);
  if (occMatch && occMatch[1]) {
    const rawRole = occMatch[1].trim();
    if (rawRole.length >= 3 && !/^(not|person|human|fan|user|member|friend)$/i.test(rawRole)) {
      facts.push({
        category: "bio",
        content: `User works as a/an ${rawRole}`,
      });
    }
  }

  // 4. User location / residence
  // e.g. "i live in Lagos", "based in Abuja", "i am based in Riyadh"
  const locationPattern =
    /(?:i\s+live\s+in|i'm\s+based\s+in|i\s+am\s+based\s+in|based\s+in|living\s+in|residing\s+in|i'm\s+from|i\s+am\s+from)\s+([A-Za-z\s\u0600-\u06FF'-]{2,30}?)(?=[.,;!?]|$|\band\b)/i;
  const locMatch = text.match(locationPattern);
  if (locMatch && locMatch[1]) {
    const rawLoc = locMatch[1].trim();
    if (rawLoc.length >= 2 && !/^(a|an|the|here|there|home)$/i.test(rawLoc)) {
      facts.push({
        category: "bio",
        content: `User is based in ${rawLoc}`,
      });
    }
  }

  // 5. Formatting and behavioral preferences
  // e.g. "always reply in bullet points", "never use python 2"
  const prefPattern =
    /(?:^|[.!?\n,])\s*(?:always|from now on,?\s+always)\s+(reply|answer|respond|code|speak|write|give|provide)\s+(?:to\s+me\s+)?(?:in|with|using)?\s*([a-zA-Z\s]{3,40}?)(?=[.,;!?]|$)/i;
  const prefMatch = text.match(prefPattern);
  if (prefMatch && prefMatch[2]) {
    facts.push({
      category: "preference",
      content: `User prefers assistant to always ${prefMatch[1]} in ${prefMatch[2].trim()}`,
    });
  }

  return facts;
}

/**
 * Primary LLM extractor using Cloudflare Workers AI.
 * Fast, free of OpenRouter daily free-tier rate limits.
 */
async function extractWithCloudflare(userText: string): Promise<string> {
  if (!serverEnv.CLOUDFLARE_ACCOUNT_ID || !serverEnv.CLOUDFLARE_API_TOKEN) {
    return "";
  }

  const prompt = `You are an AI memory extraction assistant.
Analyze the user message to extract durable personal facts, user preferences, assistant custom names, constraints, or project context.

Guidelines:
- Extract clear facts about the user (e.g. name, role, company, location, tech stack, preferences, constraints, project goals).
- If the user assigns a name to the assistant (e.g. "name you X" or "call you X"), extract as: {"category": "preference", "content": "User wants the assistant to be named X"}.
- Write each fact in clear, concise third-person phrasing (e.g. "User lives in London", "User prefers TypeScript").
- If there is nothing durable to remember, return [].
- Output strictly a valid JSON array of objects: [{"category": "...", "content": "..."}].

Allowed categories: "preference", "bio", "project", "constraint", "general".

User message:
"""
${userText.slice(0, 2000)}
"""`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.1-8b-instruct`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${serverEnv.CLOUDFLARE_API_TOKEN}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          messages: [{ role: "user", content: prompt }],
        }),
        signal: controller.signal,
      },
    );
    clearTimeout(timeout);

    if (response.ok) {
      const data = (await response.json()) as {
        result?: {
          choices?: Array<{ message?: { content?: string } }>;
          response?: string;
        };
      };
      return data.result?.choices?.[0]?.message?.content ?? data.result?.response ?? "";
    } else {
      logger.warn("cloudflare_memory_extraction_failed", { status: response.status });
    }
  } catch (err) {
    logger.warn("cloudflare_memory_extraction_error", { error: String(err) });
  }

  return "";
}

const OPENROUTER_EXTRACTOR_MODELS = [
  "poolside/laguna-s-2.1:free",
  "poolside/laguna-xs-2.1:free",
  "google/gemma-4-26b-a4b-it:free",
  "google/gemma-4-31b-it:free",
  "liquid/lfm-2.5-2.6b:free",
];

/**
 * Fallback LLM extractor using OpenRouter active free models.
 */
async function extractWithOpenRouter(userText: string): Promise<string> {
  const prompt = `You are a memory extraction assistant.
Analyze the user message to identify durable personal facts, preferences, constraints, assistant naming, or project context that should be remembered across future conversations.

Guidelines:
- Extract only clear facts about the user (e.g. name, role, tech stack, preferences, constraints, project goals) or assistant naming requests.
- If the user assigns a name to the assistant, extract as: {"category": "preference", "content": "User wants the assistant to be named X"}.
- Do not extract transient requests, code snippets, or one-time questions.
- Write each fact in clear, concise third-person phrasing.
- If there is nothing durable to remember, return an empty array [].

Allowed categories: "preference", "bio", "project", "constraint", "general".

Respond strictly with a valid JSON array:
[{"category": "preference", "content": "..."}]

User message:
"""
${userText.slice(0, 2000)}
"""`;

  for (const modelId of OPENROUTER_EXTRACTOR_MODELS) {
    try {
      const response = await fetch(`${serverEnv.OPENROUTER_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${serverEnv.OPENROUTER_API_KEY}`,
          "HTTP-Referer": serverEnv.OPENROUTER_SITE_URL ?? "https://mujeebai.yungswag.xyz",
          "X-Title": serverEnv.OPENROUTER_APP_NAME,
        },
        body: JSON.stringify({
          model: modelId,
          messages: [{ role: "user", content: prompt }],
          temperature: 0.1,
          max_tokens: 500,
        }),
      });

      if (response.ok) {
        const data = (await response.json()) as { choices?: Array<{ message?: { content?: string } }> };
        const content = data.choices?.[0]?.message?.content ?? "";
        if (content) return content;
      } else {
        logger.warn("memory_extraction_model_failed", { model: modelId, status: response.status });
      }
    } catch (upstreamErr) {
      logger.warn("memory_extraction_model_error", { model: modelId, error: String(upstreamErr) });
    }
  }

  return "";
}

/**
 * Fast synchronous/instant deterministic memory extraction and persistence.
 * Captures explicit assistant names, user names, jobs, locations, etc. in < 5ms.
 */
export async function extractAndSaveDeterministicMemories(params: {
  userId: string;
  conversationId: string;
  userText: string;
}): Promise<void> {
  const { userId, conversationId, userText } = params;
  if (!hasMemoryCandidates(userText)) return;

  const profile = await getUserMemoryProfile(userId);
  if (!profile.enabled) return;

  const directFacts = extractDeterministicFacts(userText);
  for (const fact of directFacts) {
    await addUserMemory(userId, {
      content: fact.content,
      category: fact.category,
      sourceConversationId: conversationId,
    });
  }
}

/**
 * Extracts and persists durable user memories from a completed turn.
 * Multi-tier pipeline:
 * 1. Immediate local deterministic extraction (zero latency, zero rate limits).
 * 2. Cloudflare Workers AI fast LLM extractor (limitless, high availability).
 * 3. OpenRouter active free model fallback chain.
 */
export async function extractAndSaveMemories(params: {
  userId: string;
  conversationId: string;
  userText: string;
}): Promise<void> {
  const { userId, conversationId, userText } = params;

  if (!hasMemoryCandidates(userText)) {
    return;
  }

  const profile = await getUserMemoryProfile(userId);
  if (!profile.enabled) {
    return;
  }

  // 1. Save deterministic regex facts immediately (zero-latency guarantee)
  await extractAndSaveDeterministicMemories(params);

  // 2. Call Cloudflare Workers AI LLM extractor (fast, free of OpenRouter daily cap)
  let rawJson = await extractWithCloudflare(userText);

  // 3. Fallback to OpenRouter if Cloudflare did not return output
  if (!rawJson && providerStatus.openrouter && serverEnv.OPENROUTER_API_KEY) {
    rawJson = await extractWithOpenRouter(userText);
  }

  // 4. Parse structured output and persist
  if (rawJson) {
    const facts = parseExtractedFacts(rawJson);
    if (facts.length > 0) {
      for (const fact of facts) {
        await addUserMemory(userId, {
          content: fact.content,
          category: fact.category,
          sourceConversationId: conversationId,
        });
      }
      logger.info("memories_extracted", { userId, count: facts.length });
    }
  }
}

