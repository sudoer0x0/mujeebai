import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { UserMemory, UserMemoryCategory, UserMemoryProfile } from "./types";

const SETTINGS_KEY_PREFIX = "memory:user:";

function getSettingsKey(userId: string): string {
  return `${SETTINGS_KEY_PREFIX}${userId}`;
}

interface MemoryTableRow {
  id: string;
  user_id: string;
  category: string;
  content: string;
  source_conversation_id?: string | null;
  created_at: string;
  updated_at: string;
}

interface StoredMemoryJson {
  id?: string;
  category?: string;
  content?: string;
  sourceConversationId?: string | null;
  createdAt?: string;
  updatedAt?: string;
}

interface StoredProfileJson {
  enabled?: boolean;
  memories?: StoredMemoryJson[];
}

/**
 * Retrieves a user's cross-conversation memory profile.
 * Defaults to enabled: true with empty memories.
 * Checks the dedicated `user_memories` table first. If empty, falls back to `system_settings`
 * and automatically migrates any legacy memories into `user_memories`.
 */
export async function getUserMemoryProfile(userId: string): Promise<UserMemoryProfile> {
  const supabase = createServiceRoleClient();

  // 1. Determine enabled state (default true unless explicitly disabled in settings)
  let enabled = true;
  try {
    const { data: flagData } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", `${getSettingsKey(userId)}:flag`)
      .maybeSingle();

    if (flagData?.value && typeof (flagData.value as { enabled?: boolean }).enabled === "boolean") {
      enabled = (flagData.value as { enabled?: boolean }).enabled!;
    }
  } catch {
    // Default enabled
  }

  // 2. Query dedicated `user_memories` table
  try {
    const { data: tableData, error: tableError } = await supabase
      .from("user_memories")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false });

    if (!tableError && Array.isArray(tableData) && tableData.length > 0) {
      const memories: UserMemory[] = tableData.map((row) => ({
        id: row.id,
        userId: row.user_id,
        category: (row.category as UserMemoryCategory) || "general",
        content: row.content,
        sourceConversationId: row.source_conversation_id ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      }));

      return { enabled, memories };
    }
  } catch (err) {
    logger.warn("get_user_memories_table_read_failed", { userId, error: String(err) });
  }

  // 3. Fallback to system_settings & auto-migrate if present
  try {
    const { data, error } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", getSettingsKey(userId))
      .maybeSingle();

    if (!error && data?.value) {
      const val = data.value as unknown as StoredProfileJson | StoredMemoryJson | StoredMemoryJson[];
      let legacyMemories: StoredMemoryJson[] = [];

      if (Array.isArray(val)) {
        legacyMemories = val;
      } else if (val && typeof val === "object") {
        if (Array.isArray((val as StoredProfileJson).memories)) {
          legacyMemories = (val as StoredProfileJson).memories!;
          if (typeof (val as StoredProfileJson).enabled === "boolean") {
            enabled = (val as StoredProfileJson).enabled!;
          }
        } else if (typeof (val as StoredMemoryJson).content === "string") {
          legacyMemories = [val as StoredMemoryJson];
        }
      }

      if (legacyMemories.length > 0) {
        const memories: UserMemory[] = legacyMemories
          .filter((m) => m && typeof m.content === "string" && m.content.trim().length > 0)
          .map((m) => ({
            id: m.id || crypto.randomUUID(),
            userId,
            category: (m.category as UserMemoryCategory) || "general",
            content: String(m.content).trim(),
            sourceConversationId: m.sourceConversationId ?? null,
            createdAt: m.createdAt || new Date().toISOString(),
            updatedAt: m.updatedAt || new Date().toISOString(),
          }));

        // Migrate into user_memories table
        try {
          for (const mem of memories) {
            await supabase.from("user_memories").upsert(
              {
                id: mem.id,
                user_id: userId,
                category: mem.category,
                content: mem.content,
                source_conversation_id: mem.sourceConversationId,
                created_at: mem.createdAt,
                updated_at: mem.updatedAt,
              },
              { onConflict: "id" },
            );
          }
          logger.info("migrated_legacy_memories_to_table", { userId, count: memories.length });
        } catch (migErr) {
          logger.warn("auto_migrate_memories_failed", { userId, error: String(migErr) });
        }

        return { enabled, memories };
      }
    }
  } catch (err) {
    logger.warn("get_user_memory_settings_fallback_failed", { userId, error: String(err) });
  }

  return { enabled, memories: [] };
}

/**
 * Persists the entire memory profile for a user into both system_settings and user_memories table.
 */
export async function saveUserMemoryProfile(userId: string, profile: UserMemoryProfile): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  // 1. Persist to system_settings backup
  try {
    await supabase.from("system_settings").upsert(
      {
        key: getSettingsKey(userId),
        value: {
          enabled: profile.enabled,
          memories: profile.memories,
        } as unknown as import("@/types/database").Json,
        description: `Persistent AI cross-conversation memory for user ${userId}`,
        updated_at: now,
      },
      { onConflict: "key" },
    );

    await supabase.from("system_settings").upsert(
      {
        key: `${getSettingsKey(userId)}:flag`,
        value: { enabled: profile.enabled } as unknown as import("@/types/database").Json,
        description: `Memory toggle flag for user ${userId}`,
        updated_at: now,
      },
      { onConflict: "key" },
    );
  } catch (err) {
    logger.warn("save_memory_settings_backup_failed", { userId, error: String(err) });
  }

  // 2. Persist to user_memories table
  try {
    for (const mem of profile.memories) {
      await supabase.from("user_memories").upsert(
        {
          id: mem.id,
          user_id: userId,
          category: mem.category,
          content: mem.content,
          source_conversation_id: mem.sourceConversationId,
          created_at: mem.createdAt,
          updated_at: mem.updatedAt,
        },
        { onConflict: "id" },
      );
    }
  } catch (err) {
    logger.warn("save_memory_profile_table_sync_failed", { userId, error: String(err) });
  }
}

/**
 * Adds a memory for the user. If an identical memory already exists,
 * updates its timestamp rather than duplicating.
 */
export async function addUserMemory(
  userId: string,
  item: { content: string; category?: UserMemoryCategory; sourceConversationId?: string },
): Promise<UserMemory> {
  const supabase = createServiceRoleClient();
  const profile = await getUserMemoryProfile(userId);
  const trimmed = item.content.trim();
  const category = item.category || "general";
  const now = new Date().toISOString();

  // Check if identical or same-subject memory already exists
  const existingIndex = profile.memories.findIndex((m) => {
    const existingLower = m.content.toLowerCase().trim();
    const newLower = trimmed.toLowerCase();
    if (existingLower === newLower) return true;

    // Single-subject replacement (e.g. updating name, assistant name, job, or residence)
    if (newLower.startsWith("user's name is") && existingLower.startsWith("user's name is")) return true;
    if (
      newLower.startsWith("user wants the assistant to be named") &&
      existingLower.startsWith("user wants the assistant to be named")
    ) {
      return true;
    }
    if (newLower.startsWith("user works as") && existingLower.startsWith("user works as")) return true;
    if (
      (newLower.startsWith("user lives in") || newLower.startsWith("user is based in")) &&
      (existingLower.startsWith("user lives in") || existingLower.startsWith("user is based in"))
    ) {
      return true;
    }
    return false;
  });

  let targetMemory: UserMemory;
  if (existingIndex >= 0) {
    targetMemory = {
      ...profile.memories[existingIndex],
      category,
      content: trimmed,
      updatedAt: now,
    };
    profile.memories[existingIndex] = targetMemory;
  } else {
    targetMemory = {
      id: crypto.randomUUID(),
      userId,
      category,
      content: trimmed,
      sourceConversationId: item.sourceConversationId ?? null,
      createdAt: now,
      updatedAt: now,
    };
    // Keep max 100 memories per user, newest first
    profile.memories = [targetMemory, ...profile.memories].slice(0, 100);
  }

  // 1. Direct write to user_memories table
  try {
    const { error } = await supabase.from("user_memories").upsert(
      {
        id: targetMemory.id,
        user_id: targetMemory.userId,
        category: targetMemory.category,
        content: targetMemory.content,
        source_conversation_id: targetMemory.sourceConversationId,
        created_at: targetMemory.createdAt,
        updated_at: targetMemory.updatedAt,
      },
      { onConflict: "id" },
    );
    if (error) {
      logger.warn("user_memories_table_insert_warning", { userId, error: error.message });
    }
  } catch (err) {
    logger.warn("user_memories_table_insert_failed", { userId, error: String(err) });
  }

  // 2. Also keep system_settings backup updated
  try {
    await supabase.from("system_settings").upsert(
      {
        key: getSettingsKey(userId),
        value: {
          enabled: profile.enabled,
          memories: profile.memories,
        } as unknown as import("@/types/database").Json,
        description: `Persistent AI cross-conversation memory for user ${userId}`,
        updated_at: now,
      },
      { onConflict: "key" },
    );
  } catch (err) {
    logger.warn("user_memories_settings_backup_failed", { userId, error: String(err) });
  }

  return targetMemory;
}

/**
 * Deletes a single memory by ID from both table and backup.
 */
export async function deleteUserMemory(userId: string, memoryId: string): Promise<boolean> {
  const supabase = createServiceRoleClient();
  let deletedFromTable = false;

  try {
    const { error } = await supabase
      .from("user_memories")
      .delete()
      .eq("id", memoryId)
      .eq("user_id", userId);

    if (!error) {
      deletedFromTable = true;
    }
  } catch (err) {
    logger.warn("delete_user_memory_table_failed", { userId, memoryId, error: String(err) });
  }

  // Sync deletion to system_settings backup
  try {
    const profile = await getUserMemoryProfile(userId);
    const updatedMemories = profile.memories.filter((m) => m.id !== memoryId);
    await supabase.from("system_settings").upsert(
      {
        key: getSettingsKey(userId),
        value: {
          enabled: profile.enabled,
          memories: updatedMemories,
        } as unknown as import("@/types/database").Json,
        description: `Persistent AI cross-conversation memory for user ${userId}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    // Ignore backup sync errors
  }

  return deletedFromTable;
}

/**
 * Clears all memories for a user while preserving enabled preference.
 */
export async function clearUserMemories(userId: string): Promise<void> {
  const supabase = createServiceRoleClient();

  try {
    await supabase.from("user_memories").delete().eq("user_id", userId);
  } catch (err) {
    logger.warn("clear_user_memories_table_failed", { userId, error: String(err) });
  }

  try {
    await supabase.from("system_settings").upsert(
      {
        key: getSettingsKey(userId),
        value: {
          enabled: true,
          memories: [],
        } as unknown as import("@/types/database").Json,
        description: `Persistent AI cross-conversation memory for user ${userId}`,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "key" },
    );
  } catch {
    // Ignore
  }
}

/**
 * Toggles whether memory is active for this user.
 */
export async function setMemoryEnabled(userId: string, enabled: boolean): Promise<void> {
  const supabase = createServiceRoleClient();
  const now = new Date().toISOString();

  try {
    await supabase.from("system_settings").upsert(
      {
        key: `${getSettingsKey(userId)}:flag`,
        value: { enabled } as unknown as import("@/types/database").Json,
        description: `Memory toggle flag for user ${userId}`,
        updated_at: now,
      },
      { onConflict: "key" },
    );

    const { data } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", getSettingsKey(userId))
      .maybeSingle();

    if (data?.value && typeof data.value === "object") {
      const val = data.value as unknown as StoredProfileJson;
      await supabase.from("system_settings").upsert(
        {
          key: getSettingsKey(userId),
          value: {
            ...val,
            enabled,
          } as unknown as import("@/types/database").Json,
          updated_at: now,
        },
        { onConflict: "key" },
      );
    }
  } catch (err) {
    logger.error("set_memory_enabled_failed", { userId, error: String(err) });
  }
}
