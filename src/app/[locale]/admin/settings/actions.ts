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
import { SUPPORTED_CURRENCIES } from "@/billing/currencies";
import type { Json } from "@/types/database";

/**
 * Per-setting validation.
 *
 * `system_settings.value` is a free-form jsonb column, and these values
 * feed real behaviour: `max_upload_size_mb` becomes a hard server-side
 * cap, `default_model_slug` becomes the model every new conversation
 * uses. Writing an arbitrary blob into one of them is how a typo takes
 * chat down for everybody, so each key declares the shape it accepts.
 */
const SETTING_SCHEMAS: Record<string, z.ZodType<Json>> = {
  default_model_slug: z.string().min(1).max(64),
  default_vision_model_slug: z.string().min(1).max(64),
  max_upload_size_mb: z.number().int().min(1).max(500),
  supported_locales: z.array(z.enum(["en", "fr", "ar", "pt", "es", "ja", "zh"])).min(1),
  announcement: z.union([z.string().max(500), z.null()]),

  // Operational knobs that previously required a code change and a deploy.
  //
  // `billing_currency` is the sharpest of them: Paystack rejects any
  // currency the merchant profile has not enabled, and which those are is
  // account configuration that can change without any code changing. The
  // enum is the set Paystack itself supports, not the set this account has
  // — the checkout route surfaces the account's own rejection rather than
  // guessing here.
  billing_currency: z.enum(SUPPORTED_CURRENCIES),
  default_locale: z.enum(["en", "fr", "ar", "pt", "es", "ja", "zh"]),
  support_email: z.string().email().max(200),
  free_plan_slug: z.string().min(1).max(64),
  chat_rate_limit_per_minute: z.number().int().min(1).max(600),
  max_conversation_messages: z.number().int().min(10).max(5000),
  max_attachments_per_message: z.number().int().min(1).max(20),
  staff_require_mfa_each_signin: z.boolean(),
};

const schema = z.object({ key: z.string().min(1).max(64), value: z.unknown() });

export async function updateSystemSettingAction(input: unknown): Promise<ActionResponse> {
  try {
    const actor = await requireStaff();
    assertPermission(actor, "system_settings.manage");

    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "admin.common.actionFailed" };

    const valueSchema = SETTING_SCHEMAS[parsed.data.key];
    if (!valueSchema) {
      // Unknown key: refuse rather than create a setting nothing reads.
      logger.warn("unknown_system_setting_rejected", { key: parsed.data.key });
      return { ok: false, message: "admin.common.actionFailed" };
    }

    const valueResult = valueSchema.safeParse(parsed.data.value);
    if (!valueResult.success) return { ok: false, message: "admin.common.actionFailed" };

    const supabase = createServiceRoleClient();
    const { data: before } = await supabase
      .from("system_settings")
      .select("value")
      .eq("key", parsed.data.key)
      .maybeSingle();

    const { error } = await supabase
      .from("system_settings")
      .update({ value: valueResult.data, updated_by: actor.id, updated_at: new Date().toISOString() })
      .eq("key", parsed.data.key);

    await recordAuditEvent({
      actorId: actor.id,
      action: "admin.system_setting_changed",
      targetType: "system_setting",
      targetId: parsed.data.key,
      result: error ? "failure" : "success",
      metadata: { from: before?.value ?? null, to: valueResult.data },
    });

    if (error) return { ok: false, message: "admin.common.actionFailed" };

    await revalidateRegistry();
    revalidatePath("/", "layout");
    return { ok: true, message: "admin.settings.updated" };
  } catch (error) {
    if (error instanceof ForbiddenError) return { ok: false, message: "admin.common.notPermitted" };
    logger.error("system_setting_update_failed", { error: String(error) });
    return { ok: false, message: "admin.common.actionFailed" };
  }
}
