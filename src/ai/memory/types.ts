export type UserMemoryCategory = "preference" | "bio" | "project" | "constraint" | "general";

export interface UserMemory {
  id: string;
  userId: string;
  category: UserMemoryCategory;
  content: string;
  sourceConversationId?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface UserMemoryProfile {
  /** Whether cross-conversation memory is active for this user (defaults to true). */
  enabled: boolean;
  memories: UserMemory[];
}
