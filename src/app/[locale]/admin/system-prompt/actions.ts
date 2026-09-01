"use server";

import { revalidatePath } from "next/cache";
import { revalidateRegistry } from "@/lib/cached-registry";
import { z } from "zod";
import { requireStaff, ForbiddenError } from "@/auth/session";
import { assertPermission } from "@/admin/permissions";
import { recordAuditEvent } from "@/admin/audit";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { ActionResponse } from "@/admin/user-actions";

const schema = z.object({ content: z.string().trim().min(1).max(20_000) });

/**
 * Publishes a new system-prompt version.
 *
 * Versions are append-only: publishing archives the current active
 * version and inserts a new one rather than editing in place, so the
 * prompt that produced any past response stays recoverable (#134).
 * "Restore" is just a publish of an older version's content — it never
 * rewinds history.
 */
export async function publishSystemPromptAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "system_prompt.manage");

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.systemPrompt.empty" };

    const supabase = createServiceRoleClient();

    const { data: latest } = await supabase
      .from("system_prompt_versions")
      .select("version")
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();

    const nextVersion = (latest?.version ?? 0) + 1;

    // Archive first: a partial unique index enforces at most one active
    // version, so inserting before archiving would be rejected outright.
    await supabase.from("system_prompt_versions").update({ status: "archived" }).eq("status", "active");

    const { error } = await supabase.from("system_prompt_versions").insert({
      version: nextVersion,
      content: parsed.data.content,
      status: "active",
      created_by: actor.id,
      published_at: new Date().toISOString(),
    });

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.prompt_changed",
      targetType: "system_prompt_version",
      targetId: String(nextVersion),
      result: error ? "failure" : "success",
      // Never log the prompt body itself — it is long, it is not a secret
      // but it is not useful in a log line, and the version row already
      // has it.
      metadata: { version: nextVersion, length: parsed.data.content.length },
    });

    if (error) {
      logger.error("system_prompt_publish_failed", { reason: error.message });
      return { ok: false, message: "admin.common.actionFailed" };
    }

    await revalidateRegistry();
    revalidatePath("/admin/system-prompt");
    return { ok: true, message: "admin.systemPrompt.published", count: nextVersion };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("system_prompt_publish_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}

export async function restoreSystemPromptVersionAction(versionId: string): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "system_prompt.manage");

    const supabase = createServiceRoleClient();
    const { data: version } = await supabase
      .from("system_prompt_versions")
      .select("content, version")
      .eq("id", versionId)
      .maybeSingle();

    if (!version) return { ok: false, message: "admin.common.actionFailed" };

    const result = await publishSystemPromptAction({ content: version.content });
    if (result.ok) {
      await recordAuditEvent({
        actorId: actor.id,
        action: "admin.prompt_restored",
        targetType: "system_prompt_version",
        targetId: String(version.version),
        metadata: { restoredFrom: version.version },
      });
      return { ok: true, message: "admin.systemPrompt.restored" };
    }
    return result;
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("system_prompt_restore_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}
