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

const schema = z.object({ flagId: z.string().uuid(), enabled: z.boolean() });

export async function toggleFeatureFlagAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "feature_flags.manage");

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.common.actionFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("feature_flags")
      .select("key, enabled")
      .eq("id", parsed.data.flagId)
      .maybeSingle();

    const { error } = await supabase
      .from("feature_flags")
      .update({ enabled: parsed.data.enabled, updated_by: actor.id, updated_at: new Date().toISOString() })
      .eq("id", parsed.data.flagId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.feature_flag_changed",
      targetType: "feature_flag",
      targetId: parsed.data.flagId,
      result: error ? "failure" : "success",
      metadata: { key: before?.key ?? null, enabled: parsed.data.enabled, from: before?.enabled ?? null, to: parsed.data.enabled },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    // Flags gate behaviour app-wide, so no single path revalidation is
    // enough — the layout is the common ancestor of every consumer.
    await revalidateRegistry();
    revalidatePath("/", "layout");
    return { ok: true, message: "admin.featureFlags.updated" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("feature_flag_toggle_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}
