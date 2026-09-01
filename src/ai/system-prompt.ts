import "server-only";
import { cache } from "react";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

const FALLBACK_PROMPT = "You are Mujeeb AI, a helpful, honest and safe multilingual assistant.";

// Loads active system prompt version.
export const getActiveSystemPrompt = cache(async (): Promise<string> => {
  try {
    const supabase = createServiceRoleClient();
    const { data } = await supabase
      .from("system_prompt_versions")
      .select("content")
      .eq("status", "active")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    return data?.content ?? FALLBACK_PROMPT;
  } catch (error) {
    logger.warn("system_prompt_load_failed", { error: String(error) });
    return FALLBACK_PROMPT;
  }
});
