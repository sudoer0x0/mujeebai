import type { UserMemoryProfile } from "./types";

/**
 * Formats a user's memory profile into a system prompt section.
 * If memory is disabled or there are no memories, returns an empty string.
 */
export function formatMemoriesForPrompt(profile: UserMemoryProfile, maxItems = 25): string {
  if (!profile.enabled || profile.memories.length === 0) {
    return "";
  }

  const items = profile.memories.slice(0, maxItems);
  const formattedItems = items.map((m) => `- [${m.category}]: ${m.content}`).join("\n");

  return `<user_memories>
The following are confirmed, persistent facts and preferences about this user remembered across previous conversations:
${formattedItems}

INSTRUCTIONS REGARDING USER MEMORIES:
- You already know these facts about the user and your interactions with them across past conversations. They are true, confirmed, and persistent.
- When the user asks about their identity, name, age, birthday, role, location, current whereabouts, residence, planned trips, travel, favorite sports, favorite teams, hobbies, preferences, or past context (e.g. "what is my age?", "how old am I?", "what is my favorite sport?", "which team do I support?", "what is my name?", "where do I live?", "where do I stay?", "do I have any planned trip?", "what is my job?"), you MUST answer directly, naturally, and accurately using the facts above.
- If the user provides an update, correction, new travel plan, or relocation (e.g. "I am moving to X", "I will be travelling to Y", "my favorite team is now Z", "update your memory"), acknowledge and confirm the update naturally.
- If memories include upcoming travel or planned trips (e.g. "User plans to return to X" or "User has an upcoming trip to X"), confirm it directly when asked about trips, vacations, or travel plans.
- NEVER claim that you do not know the user's age, favorite sport, favorite team, name, current location, planned trips, your assigned name, or personal facts if they are recorded in these memories.
- Naturally adapt your tone, style, and responses according to these preferences without reciting the entire list unprompted.
</user_memories>`;
}

