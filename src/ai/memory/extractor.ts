import "server-only";
import dns from "node:dns";
import { serverEnv, providerStatus } from "@/lib/env.server";
import { logger } from "@/lib/logger";
import { getUserMemoryProfile, addUserMemory } from "./store";
import type { UserMemoryCategory } from "./types";
import type { ChatMessageInput } from "@/ai/types";

try {
  dns.setDefaultResultOrder?.("ipv4first");
} catch {
  // Ignore in environments where setDefaultResultOrder is not supported
}

/**
 * Regex pre-filter to detect whether a user message potentially
 * contains personal facts, preferences, constraints, location, travel, or instructions.
 * Skips LLM extraction for purely generic/factual queries.
 */
export function hasMemoryCandidates(text: string, conversationHistory?: ChatMessageInput[]): boolean {
  if (!text || text.trim().length < 2) return false;
  const lower = text.toLowerCase().trim();

  // If this turn is answering an assistant question, it has high likelihood of being personal info
  if (conversationHistory && conversationHistory.length >= 2) {
    const prevTurn = conversationHistory[conversationHistory.length - 2];
    if (prevTurn && prevTurn.role === "assistant") {
      const prevContent = typeof prevTurn.content === "string" ? prevTurn.content.toLowerCase() : "";
      if (
        prevContent.includes("?") &&
        (prevContent.includes("sport") ||
          prevContent.includes("team") ||
          prevContent.includes("name") ||
          prevContent.includes("live") ||
          prevContent.includes("from") ||
          prevContent.includes("age") ||
          prevContent.includes("old") ||
          prevContent.includes("job") ||
          prevContent.includes("work") ||
          prevContent.includes("do you") ||
          prevContent.includes("which") ||
          prevContent.includes("who") ||
          prevContent.includes("where"))
      ) {
        return true;
      }
    }
  }

  // Explicit memory / storage / reminder keywords across languages (with typo tolerance)
  if (
    lower.includes("memory") ||
    lower.includes("remember") ||
    lower.includes("rember") ||
    lower.includes("memorize") ||
    lower.includes("keep in mind") ||
    lower.includes("note that") ||
    lower.includes("take note") ||
    lower.includes("don't forget") ||
    lower.includes("dont forget") ||
    lower.includes("save this") ||
    lower.includes("store this") ||
    lower.includes("update memory") ||
    lower.includes("update your memory") ||
    lower.includes("uodate memory") ||
    lower.includes("uodate your memory") ||
    lower.includes("change my") ||
    lower.includes("record this") ||
    lower.includes("تذكر") ||
    lower.includes("احفظ") ||
    lower.includes("ذاكرة") ||
    lower.includes("recuerda") ||
    lower.includes("guarda") ||
    lower.includes("actualiza tu memoria") ||
    lower.includes("mémoire") ||
    lower.includes("rappelle") ||
    lower.includes("lembre") ||
    lower.includes("记住") ||
    lower.includes("覚えて")
  ) {
    return true;
  }

  // Travel, trip plans, relocation, and current whereabouts
  if (
    lower.includes("currently in") ||
    lower.includes("going back to") ||
    lower.includes("going to") ||
    lower.includes("travel to") ||
    lower.includes("travelling to") ||
    lower.includes("traveling to") ||
    lower.includes("flying to") ||
    lower.includes("visiting") ||
    lower.includes("staying in") ||
    lower.includes("staying at") ||
    lower.includes("moving to") ||
    lower.includes("relocating to") ||
    lower.includes("planned trip") ||
    lower.includes("upcoming trip") ||
    lower.includes("my trip") ||
    lower.includes("my flight")
  ) {
    return true;
  }

  // Personal preferences, identity, age, sports, teams, traits & assistant naming
  const personalPatterns = [
    /\b(i prefer|i like|i love|i hate|i usually|i always|i never|i want|i plan)\b/,
    /\b(call me|name me|my name is|my nickname is)\b/,
    /\b(name you|call you|your name is|i will call you|call yourself)\b/,
    /\b(i am a|i am an|i'm a|i'm an|im a|im an|i work as|i work at|i work in|i live in|i am based in|my job is)\b/,
    /\b(i am building|we are building|my project is|my stack is|my company is|i study|i go to)\b/,
    /\b(always use|never use|don't ever use|avoid using|from now on)\b/,
    /\b(?:i\s+am|i'm|im|my\s+age\s+is)\s+(?:aged\s+)?\d{1,3}(?:\s+years?\s+old)?\b/,
    /\b(my\s+favou?rite|favou?rite\s+(?:sport|team|food|dish|movie|song|color|colour|hobby|game))\b/,
    /\b(i\s+support|my\s+team\s+is|fan\s+of|i\s+follow)\b/,
    /\b(football|soccer|chelsea|arsenal|barcelona|madrid|manchester)\b/,
    /\b(my\s+birthday\s+is|born\s+on|born\s+in)\b/,
    /\b(i\s+speak|fluent\s+in|native\s+language)\b/,
    /\b(married|single|divorced|engaged|kids|children)\b/,
    /(اسمي|أنا أعمل|أنا أفضل|أفضل استخدام|مشروعي هو|نحن نطور|سميتك|اسمك هو|نادني|عمري|أشجع|فريقي المفضل)/,
    /(me llamo|mi nombre es|prefiero|siempre usa|no uses|te llamo|tengo \d+ años|mi equipo favorito)/,
    /(je m'appelle|je préfère|je travaille comme|utilise toujours|je te nomme|j'ai \d+ ans)/,
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
 * 1. Current location & whereabouts ("currently in Lagos", "staying in Abuja")
 * 2. Planned trips & travel ("going back to Kaduna soon", "travelling to London next week")
 * 3. Assistant naming / persona directives ("name you X", "your name is X")
 * 4. User name and nicknames ("my name is X", "call me X", "اسمي X")
 * 5. User profession / occupation ("i am a software engineer", "i work as a doctor")
 * 6. User location / residence ("i live in Lagos", "i am based in Riyadh")
 * 7. Formatting / behavior rules ("always reply in bullet points", "never use python 2")
 *
 * Runs locally with 0ms latency and zero external API dependencies.
 */
export function extractDeterministicFacts(text: string): ExtractedFact[] {
  const facts: ExtractedFact[] = [];
  if (!text || text.length < 4) return facts;

  // 1. Current location / whereabouts
  // e.g. "im currently in lagos", "i am currently in Lagos", "currently staying in London"
  const locStop =
    "(?=[.,;!?]|$|\\s+(?:and|but|so|where|which|though|although|because|while|since|with|uodate|update)\\b)";
  const currLocPattern = new RegExp(
    "(?:(?:i['’]?m|im|i\\s+am)\\s+)?currently\\s+(?:in|staying\\s+in|living\\s+in|based\\s+in)\\s+([A-Za-z\\u0600-\\u06FF'-]+(?:\\s+[A-Za-z\\u0600-\\u06FF'-]+)?)" +
      locStop,
    "i",
  );
  const currLocMatch = text.match(currLocPattern);
  if (currLocMatch && currLocMatch[1]) {
    const rawLoc = currLocMatch[1].trim();
    if (rawLoc.length >= 2 && !/^(a|an|the|here|there|home|my|this|that|not|and|but)$/i.test(rawLoc)) {
      const formattedLoc = rawLoc
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      facts.push({
        category: "bio",
        content: `User is currently in ${formattedLoc}`,
      });
    }
  }

  // 2. Upcoming travel / planned trips / return plans
  // e.g. "i will be going back to kaduna soon", "travelling to London next week", "going to Abuja"
  const timingKeywords = "(?:soon|next\\s+week|tomorrow|next\\s+month|this\\s+weekend|later)";
  const travelPattern = new RegExp(
    "(?:(?:i['’]?m|im|i\\s+am|i)\\s+(?:will\\s+be\\s+|will\\s+|plan\\s+to\\s+|am\\s+planning\\s+to\\s+)?(?:going\\s+back\\s+to|return\\s+to|returning\\s+to|going\\s+to|travelling\\s+to|traveling\\s+to|flying\\s+to|visiting|moving\\s+to))\\s+([A-Za-z\\u0600-\\u06FF'-]+)",
    "i",
  );
  const travelMatch = text.match(travelPattern);
  if (travelMatch && travelMatch[1]) {
    const rawDest = travelMatch[1].trim();
    if (rawDest.length >= 2 && !/^(a|an|the|my|this|that|home|school|work|bed|sleep|and|but)$/i.test(rawDest)) {
      const formattedDest = rawDest
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      const timingMatch =
        text.match(new RegExp(`(?:going\\s+back\\s+to|return\\s+to|going\\s+to|travelling\\s+to|visiting)\\s+${rawDest}\\s+(${timingKeywords})`, "i")) ||
        text.match(new RegExp(`\\b(${timingKeywords})\\b`, "i"));
      const timingPhrase = timingMatch && timingMatch[1] ? ` ${timingMatch[1].toLowerCase()}` : "";
      facts.push({
        category: "bio",
        content: `User plans to return to ${formattedDest}${timingPhrase}`,
      });
    }
  }

  // 3. Assistant naming / persona directives
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

  // 4. User name matchers
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

  // 5. User profession / occupation
  // e.g. "i am a software engineer", "also i am a software engineer", "i work as a doctor"
  const occupationPattern =
    /(?:^|[.!?\n,])\s*(?:(?:also|and|plus|actually|by the way)\s+)?(?:i\s+am\s+(?:a|an)|i'm\s+(?:a|an)|im\s+(?:a|an)|i\s+work\s+as\s+(?:a|an))\s+([a-zA-Z\s]{3,35}?)(?=[.,;!?]|$|\band\b|\bwho\b|\bbased\b|\bliving\b)/i;
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

  // 6. User location / permanent residence (when not already caught as current location)
  // e.g. "i live in Lagos", "based in Abuja", "i am based in Riyadh"
  if (!facts.some((f) => f.content.startsWith("User is currently in"))) {
    const locationPattern =
      /(?:i\s+live\s+in|i'm\s+based\s+in|im\s+based\s+in|i\s+am\s+based\s+in|based\s+in|living\s+in|residing\s+in|i'm\s+from|im\s+from|i\s+am\s+from)\s+([A-Za-z\s\u0600-\u06FF'-]{2,30}?)(?=[.,;!?]|$|\band\b|\bbut\b)/i;
    const locMatch = text.match(locationPattern);
    if (locMatch && locMatch[1]) {
      const rawLoc = locMatch[1].trim();
      if (rawLoc.length >= 2 && !/^(a|an|the|here|there|home)$/i.test(rawLoc)) {
        const formattedLoc = rawLoc
          .split(/\s+/)
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
          .join(" ");
        facts.push({
          category: "bio",
          content: `User is based in ${formattedLoc}`,
        });
      }
    }
  }

  // 7. Formatting and behavioral preferences
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

  // 8. User age
  // e.g. "i am 20 years old", "i'm 20", "im 20 years old", "my age is 20"
  const agePattern =
    /(?:^|[.!?\n,]|(?:by the way|actually|also)\s+)?(?:i\s+am|i['’]?m|im|my\s+age\s+is)\s+(?:aged\s+)?(\d{1,3})(?:\s+years?\s+old)?(?=[.,;!?]|$|\s+(?:and|but|so|uodate|update)\b)/i;
  const ageMatch = text.match(agePattern);
  if (ageMatch && ageMatch[1]) {
    const ageNum = parseInt(ageMatch[1], 10);
    if (ageNum >= 5 && ageNum <= 120) {
      facts.push({
        category: "bio",
        content: `User is ${ageNum} years old`,
      });
    }
  }

  // 9. Favorite sport or hobby
  // e.g. "my favorite sport is football", "my favourite sport is soccer"
  const favSportPattern =
    /(?:my\s+favou?rite\s+(?:sport|game|hobby)\s+is|my\s+(?:sport|hobby)\s+is)\s+([a-zA-Z\s]{3,30}?)(?=[.,;!?]|$|\s+(?:and|but|so|where|uodate|update)\b)/i;
  const favSportMatch = text.match(favSportPattern);
  if (favSportMatch && favSportMatch[1]) {
    const rawSport = favSportMatch[1].trim();
    if (!/^(a|an|the|my|this|that|not|very|good|bad)$/i.test(rawSport)) {
      const formattedSport = rawSport.toLowerCase();
      facts.push({
        category: "preference",
        content: `User's favorite sport is ${formattedSport}`,
      });
    }
  }

  // 10. Favorite team / supporting sports team
  // e.g. "i support chelsea", "my favorite team is chelsea", "i'm a fan of Arsenal"
  const teamPattern =
    /(?:(?:i\s+support|my\s+favou?rite\s+team\s+is|my\s+team\s+is|i['’]?m\s+a\s+fan\s+of|im\s+a\s+fan\s+of|i\s+am\s+a\s+fan\s+of)\s+)([a-zA-Z0-9\s'-]{2,35}?)(?=[.,;!?]|$|\s+(?:and|but|so|where|uodate|update)\b)/i;
  const teamMatch = text.match(teamPattern);
  if (teamMatch && teamMatch[1]) {
    const rawTeam = teamMatch[1].trim();
    if (!/^(a|an|the|my|this|that|not|you|them|all|any)$/i.test(rawTeam)) {
      const formattedTeam = rawTeam
        .split(/\s+/)
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(" ");
      facts.push({
        category: "preference",
        content: `User supports ${formattedTeam}`,
      });
    }
  }

  // 11. General favorites (food, dish, drink, color, movie, film, book, song)
  // e.g. "my favorite food is pizza", "my favourite color is blue"
  const generalFavPattern =
    /my\s+favou?rite\s+(food|dish|drink|color|colour|movie|film|book|song)\s+is\s+([a-zA-Z0-9\s'-]{2,35}?)(?=[.,;!?]|$|\s+(?:and|but|so)\b)/i;
  const generalFavMatch = text.match(generalFavPattern);
  if (generalFavMatch && generalFavMatch[1] && generalFavMatch[2]) {
    const favType = generalFavMatch[1].toLowerCase() === "colour" ? "color" : generalFavMatch[1].toLowerCase();
    const favVal = generalFavMatch[2].trim();
    if (!/^(a|an|the|my|this|that|not)$/i.test(favVal)) {
      facts.push({
        category: "preference",
        content: `User's favorite ${favType} is ${favVal.toLowerCase()}`,
      });
    }
  }

  // 12. Spoken languages
  // e.g. "i speak english and french", "i'm fluent in Arabic"
  const langPattern =
    /(?:i\s+speak|i['’]?m\s+fluent\s+in|im\s+fluent\s+in|my\s+native\s+language\s+is)\s+([a-zA-Z\s,and]+?)(?=[.,;!?]|$|\s+(?:and\s+i|but)\b)/i;
  const langMatch = text.match(langPattern);
  if (langMatch && langMatch[1]) {
    const rawLang = langMatch[1].trim();
    if (!/^(a|an|the|very|well|fast|slowly|not)$/i.test(rawLang)) {
      const formattedLang = rawLang
        .split(/(?:,|\s+and\s+|\s+)/)
        .filter((w) => w.length > 2 && !/^(and|with)$/i.test(w))
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join(", ");
      if (formattedLang) {
        facts.push({
          category: "bio",
          content: `User speaks ${formattedLang}`,
        });
      }
    }
  }

  // 13. Birthdays
  // e.g. "my birthday is May 14", "i was born on June 2"
  const bdayPattern =
    /(?:my\s+birthday\s+is(?:\s+on)?|i\s+was\s+born\s+on)\s+([a-zA-Z0-9\s,]+?)(?=[.,;!?]|$|\s+(?:and|but)\b)/i;
  const bdayMatch = text.match(bdayPattern);
  if (bdayMatch && bdayMatch[1]) {
    const rawBday = bdayMatch[1].trim();
    if (rawBday.length >= 3 && !/^(a|the|not|today)$/i.test(rawBday)) {
      facts.push({
        category: "bio",
        content: `User's birthday is ${rawBday}`,
      });
    }
  }

  // 14. Marital status
  if (/\b(?:i\s+am\s+married|i['’]?m\s+married|im\s+married)\b/i.test(text)) {
    facts.push({ category: "bio", content: "User is married" });
  } else if (/\b(?:i\s+am\s+single|i['’]?m\s+single|im\s+single)\b/i.test(text)) {
    facts.push({ category: "bio", content: "User is single" });
  }

  return facts;
}

/**
 * Primary LLM extractor using Cloudflare Workers AI.
 * Uses flagship fast model with high accuracy and high quota.
 */
async function extractWithCloudflare(
  userText: string,
  conversationHistory?: ChatMessageInput[],
): Promise<string> {
  if (!serverEnv.CLOUDFLARE_ACCOUNT_ID || !serverEnv.CLOUDFLARE_API_TOKEN) {
    return "";
  }

  let contextSnippet = "";
  if (conversationHistory && conversationHistory.length >= 2) {
    const recent = conversationHistory.slice(-3);
    const lines = recent.map((m) => {
      const txt = typeof m.content === "string" ? m.content : "";
      return `${m.role === "assistant" ? "Assistant" : "User"}: "${txt.slice(0, 300)}"`;
    });
    contextSnippet = `\nRecent conversation turns for context (resolve questions and short answers):\n${lines.join("\n")}\n`;
  }

  const prompt = `You are an AI memory extraction assistant.
Analyze the user message (and recent conversation context if provided) to extract durable personal facts, age, birthday, favorite sports/teams, hobbies, favorite foods/colors, current location, travel/trip plans, preferences, custom assistant names, or project context that should be remembered across future conversations.

Guidelines:
- Extract clear facts about the user (e.g. name, age, profession, current location, upcoming trips/travel plans, favorite sports, teams they support, tech stack, preferences, constraints, project goals).
- If the assistant asked a question (e.g. "Which team do you support?" or "How old are you?") and the user replied (e.g. "Chelsea" or "20"), extract as: {"category": "preference", "content": "User supports Chelsea FC"} or {"category": "bio", "content": "User is 20 years old"}.
- If user mentions age (e.g. "I am 20 years old"), extract as: {"category": "bio", "content": "User is 20 years old"}.
- If user mentions favorite sport (e.g. "my favorite sport is football"), extract as: {"category": "preference", "content": "User's favorite sport is football"}.
- If user mentions supporting a team (e.g. "i support Chelsea"), extract as: {"category": "preference", "content": "User supports Chelsea"}.
- If the user mentions their current location or where they are staying, extract as: {"category": "bio", "content": "User is currently in <Location>"}.
- If the user mentions upcoming travel, trips, or returning to a place, extract as: {"category": "bio", "content": "User plans to return/travel to <Location> <timing>"}.
- If the user assigns a name to the assistant (e.g. "name you X" or "call you X"), extract as: {"category": "preference", "content": "User wants the assistant to be named X"}.
- Write each fact in clear, concise third-person phrasing.
- If there is nothing durable to remember, return [].
- Output strictly a valid JSON array of objects: [{"category": "...", "content": "..."}].

Allowed categories: "preference", "bio", "project", "constraint", "general".
${contextSnippet}
User message to extract from:
"""
${userText.slice(0, 2000)}
"""`;

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${serverEnv.CLOUDFLARE_ACCOUNT_ID}/ai/run/@cf/meta/llama-3.3-70b-instruct-fp8-fast`,
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
async function extractWithOpenRouter(
  userText: string,
  conversationHistory?: ChatMessageInput[],
): Promise<string> {
  let contextSnippet = "";
  if (conversationHistory && conversationHistory.length >= 2) {
    const recent = conversationHistory.slice(-3);
    const lines = recent.map((m) => {
      const txt = typeof m.content === "string" ? m.content : "";
      return `${m.role === "assistant" ? "Assistant" : "User"}: "${txt.slice(0, 300)}"`;
    });
    contextSnippet = `\nRecent conversation turns for context:\n${lines.join("\n")}\n`;
  }

  const prompt = `You are a memory extraction assistant.
Analyze the user message (and conversation context) to identify durable personal facts, age, favorite sports/teams, preferences, constraints, assistant naming, or project context that should be remembered across future conversations.

Guidelines:
- Extract only clear facts about the user (e.g. name, age, favorite sport/team, role, tech stack, preferences, constraints, project goals) or assistant naming requests.
- If the assistant asked a question and the user gave a direct answer, resolve and extract it.
- Write each fact in clear, concise third-person phrasing.
- If there is nothing durable to remember, return an empty array [].

Allowed categories: "preference", "bio", "project", "constraint", "general".
${contextSnippet}
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
 * Captures explicit assistant names, user names, jobs, locations, age, sports, etc. in < 5ms.
 */
export async function extractAndSaveDeterministicMemories(params: {
  userId: string;
  conversationId: string;
  userText: string;
  conversationHistory?: ChatMessageInput[];
}): Promise<ExtractedFact[]> {
  const { userId, conversationId, userText, conversationHistory } = params;
  if (!hasMemoryCandidates(userText, conversationHistory)) return [];

  const profile = await getUserMemoryProfile(userId);
  if (!profile.enabled) return [];

  const saved: ExtractedFact[] = [];
  const directFacts = extractDeterministicFacts(userText);
  for (const fact of directFacts) {
    await addUserMemory(userId, {
      content: fact.content,
      category: fact.category,
      sourceConversationId: conversationId,
    });
    saved.push(fact);
  }
  return saved;
}

/**
 * Extracts and persists durable user memories from a completed turn.
 * Multi-tier pipeline:
 * 1. Immediate local deterministic extraction (zero latency, zero rate limits).
 * 2. Cloudflare Workers AI fast LLM extractor (limitless, high availability).
 * 3. OpenRouter active free model fallback chain.
 *
 * Returns all newly saved or updated facts for real-time UI display.
 */
export async function extractAndSaveMemories(params: {
  userId: string;
  conversationId: string;
  userText: string;
  conversationHistory?: ChatMessageInput[];
}): Promise<ExtractedFact[]> {
  const { userId, conversationId, userText, conversationHistory } = params;

  if (!hasMemoryCandidates(userText, conversationHistory)) {
    return [];
  }

  const profile = await getUserMemoryProfile(userId);
  if (!profile.enabled) {
    return [];
  }

  const saved: ExtractedFact[] = [];

  // 1. Save deterministic regex facts immediately (zero-latency guarantee)
  const directFacts = await extractAndSaveDeterministicMemories(params);
  saved.push(...directFacts);

  // 2. Call Cloudflare Workers AI LLM extractor (fast, free of OpenRouter daily cap)
  let rawJson = await extractWithCloudflare(userText, conversationHistory);

  // 3. Fallback to OpenRouter if Cloudflare did not return output
  if (!rawJson && providerStatus.openrouter && serverEnv.OPENROUTER_API_KEY) {
    rawJson = await extractWithOpenRouter(userText, conversationHistory);
  }

  // 4. Parse structured output and persist
  if (rawJson) {
    const facts = parseExtractedFacts(rawJson);
    if (facts.length > 0) {
      for (const fact of facts) {
        const alreadySaved = saved.some(
          (f) => f.content.toLowerCase().trim() === fact.content.toLowerCase().trim(),
        );
        if (!alreadySaved) {
          await addUserMemory(userId, {
            content: fact.content,
            category: fact.category,
            sourceConversationId: conversationId,
          });
          saved.push(fact);
        }
      }
      logger.info("memories_extracted", { userId, count: saved.length });
    }
  }

  return saved;
}

