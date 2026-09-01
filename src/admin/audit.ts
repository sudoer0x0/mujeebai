import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { Json } from "@/types/database";

// Records an immutable admin audit log event.
export async function recordAuditEvent(params: {
  actorId: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  result?: "success" | "failure";
  metadata?: Record<string, Json | undefined>;
}) {
  try {
    const supabase = createServiceRoleClient();
    await supabase.from("admin_audit_logs").insert({
      actor_id: params.actorId,
      action: params.action,
      target_type: params.targetType ?? null,
      target_id: params.targetId ?? null,
      result: params.result ?? "success",
      metadata: (params.metadata ?? {}) as Json,
    });
  } catch (error) {
    // Audit logging must never take down the primary action; log locally
    // and move on. A missing service-role key in local dev commonly lands
    // here — that's expected and fine.
    logger.warn("admin_audit_log_failed", { action: params.action, error: String(error) });
  }
}
