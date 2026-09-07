"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { requireUser } from "@/auth/session";
import {
  setMemoryEnabled,
  addUserMemory,
  deleteUserMemory,
  clearUserMemories,
} from "@/ai/memory/store";
import type { UserMemoryCategory } from "@/ai/memory/types";
import { logger } from "@/lib/logger";

const addMemorySchema = z.object({
  content: z.string().trim().min(2).max(500),
  category: z.enum(["preference", "bio", "project", "constraint", "general"]).default("general"),
});

export async function toggleMemoryAction(enabled: boolean) {
  try {
    const user = await requireUser();
    await setMemoryEnabled(user.id, enabled);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    logger.error("toggle_memory_action_failed", { error: String(error) });
    return { ok: false, message: "settings.memory.toggleFailed" };
  }
}

export async function addMemoryAction(content: string, category: UserMemoryCategory = "general") {
  try {
    const user = await requireUser();
    const parsed = addMemorySchema.safeParse({ content, category });
    if (!parsed.success) {
      return { ok: false, message: "settings.memory.invalidInput" };
    }

    const memory = await addUserMemory(user.id, {
      content: parsed.data.content,
      category: parsed.data.category as UserMemoryCategory,
    });

    revalidatePath("/settings");
    return { ok: true, memory };
  } catch (error) {
    logger.error("add_memory_action_failed", { error: String(error) });
    return { ok: false, message: "settings.memory.addFailed" };
  }
}

export async function deleteMemoryAction(memoryId: string) {
  try {
    const user = await requireUser();
    if (!memoryId) return { ok: false };

    await deleteUserMemory(user.id, memoryId);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    logger.error("delete_memory_action_failed", { error: String(error) });
    return { ok: false, message: "settings.memory.deleteFailed" };
  }
}

export async function clearAllMemoriesAction() {
  try {
    const user = await requireUser();
    await clearUserMemories(user.id);
    revalidatePath("/settings");
    return { ok: true };
  } catch (error) {
    logger.error("clear_all_memories_action_failed", { error: String(error) });
    return { ok: false, message: "settings.memory.clearFailed" };
  }
}
