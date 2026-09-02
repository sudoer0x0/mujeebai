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

const updateSchema = z.object({
  modelId: z.string().uuid(),
  availability: z.enum(["available", "locked", "disabled", "maintenance", "deprecated"]).optional(),
  tier: z.enum(["free", "pro", "premium", "experimental"]).optional(),
  priority: z.number().int().min(0).max(1000).optional(),
  /**
   * The provider's own model id, e.g. `openrouter/free` or
   * `nvidia/nemotron-3.5-lightning:free`.
   *
   * Editable so a slot can be repointed without a deploy — which is the
   * only way to get consistency out of a router that changes what it
   * picks. Constrained to the characters provider ids actually use, so
   * this cannot become a way to put arbitrary text into an upstream URL.
   */
  providerModelId: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .regex(/^[A-Za-z0-9._\/@:-]+$/, "invalid model id")
    .optional(),
  reasoningMode: z.enum(["auto", "exclude", "require"]).optional(),
});

export async function updateModelAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "models.manage");

    const parsed = updateSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.common.actionFailed" };

    const { modelId, providerModelId, reasoningMode, ...rest } = parsed.data;
    // Column names, not camelCase, from here down.
    const updates = {
      ...rest,
      ...(providerModelId !== undefined ? { provider_model_id: providerModelId } : {}),
      ...(reasoningMode !== undefined ? { reasoning_mode: reasoningMode } : {}),
    };
    if (Object.keys(updates).length === 0) return { ok: true };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("models")
      .select("slug, availability, tier, priority, provider_model_id, reasoning_mode")
      .eq("id", modelId)
      .maybeSingle();

    const { error } = await supabase.from("models").update(updates).eq("id", modelId);

    await recordAuditEvent({
      actorId: actor.id,
      // Distinguish the transitions in the audit trail — "model_updated"
      // for every change makes it impossible to answer "when did this stop
      // being available?" without diffing metadata by hand.
      action:
        updates.availability === "disabled"
          ? "admin.model_disabled"
          : updates.availability === "available"
            ? "admin.model_enabled"
            : "admin.model_updated",
      targetType: "model",
      targetId: modelId,
      result: error ? "failure" : "success",
      metadata: { slug: before?.slug ?? null, from: before ?? null, to: updates },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    await revalidateRegistry();
    revalidatePath("/admin/models");
    return { ok: true, message: "admin.models.updated" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("model_update_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}
