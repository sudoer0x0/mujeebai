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
- You already know these facts about the user and your interactions with them. They are true, confirmed, and persistent.
- When the user asks about their identity, name, role, location, preferences, or past context (e.g. "what is my name?", "who am I?", "where do I live?", "what is my job?"), you MUST answer directly and accurately using the facts above.
- If the memories state that the user named you or gave you a nickname (e.g. "User wants the assistant to be named <Name>"), you MUST adopt that name and confirm it whenever asked (e.g. "what name did I give you?", "what is your name?").
- NEVER claim that you do not know the user's name, your assigned name, or personal facts if they are listed in these memories.
- Naturally adapt your tone, style, and responses according to these preferences without reciting the entire list unprompted.
</user_memories>`;
}

