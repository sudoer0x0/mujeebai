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

const schema = z.object({ providerId: z.string().uuid(), enabled: z.boolean() });

export async function toggleProviderAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "providers.manage");

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.common.actionFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("providers")
      .select("slug")
      .eq("id", parsed.data.providerId)
      .maybeSingle();

    const { error } = await supabase
      .from("providers")
      .update({ enabled: parsed.data.enabled })
      .eq("id", parsed.data.providerId);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.provider_changed",
      targetType: "provider",
      targetId: parsed.data.providerId,
      result: error ? "failure" : "success",
      metadata: { slug: before?.slug ?? null, enabled: parsed.data.enabled },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    await revalidateRegistry();
    revalidatePath("/admin/providers");
    return { ok: true, message: "admin.providers.toggled" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("provider_toggle_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}
