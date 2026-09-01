"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient, createServiceRoleClient } from "@/lib/supabase/server";
import { listDeviceSessions, revokeDeviceSession, type DeviceSession } from "@/auth/device-sessions";
import { recordAuditEvent } from "@/admin/audit";
import { logger } from "@/lib/logger";

/**
 * A user's own devices.
 *
 * Every action here resolves the user from the request's own session and
 * passes *that* id down — nothing accepts a user id from the client. The
 * only thing a caller supplies is which of their own sessions to end, and
 * that is checked against their id in SQL as well.
 */

export interface SessionsResult {
  sessions: DeviceSession[];
}

export async function listMyDevicesAction(): Promise<SessionsResult> {
  const user = await requireUser();
  return { sessions: await listDeviceSessions(user.id) };
}

const revokeSchema = z.object({ sessionId: z.string().uuid() });

export async function revokeMyDeviceAction(input: unknown): Promise<{ ok: boolean; message?: string }> {
  try {
    const user = await requireUser();

    const parsed = revokeSchema.safeParse(input);
    if (!parsed.success) return { ok: false, message: "settings.devices.failed" };

    const ok = await revokeDeviceSession(user.id, parsed.data.sessionId);
    if (!ok) return { ok: false, message: "settings.devices.notFound" };

    // Worth an audit entry: an account signing a device out is a security
    // event, and it is the kind of thing support gets asked about later.
    await recordAuditEvent({
      actorId: user.id,
      action: "account.device_revoked",
      targetType: "user",
      targetId: user.id,
      result: "success",
      metadata: {},
    });

    revalidatePath("/settings");
    return { ok: true, message: "settings.devices.revoked" };
  } catch (error) {
    logger.error("revoke_device_failed", { error: String(error) });
    return { ok: false, message: "settings.devices.failed" };
  }
}

/**
 * Ends every session except this one.
 *
 * `scope: "others"` rather than "global": someone reaching for this has
 * usually spotted a device they do not recognise, and signing themselves
 * out too would mean losing the page they are standing on mid-task. The
 * device they are using is the one they trust by definition.
 */
export async function signOutOtherDevicesAction(): Promise<{ ok: boolean; message?: string }> {
  try {
    const user = await requireUser();
    const supabase = await createServerSupabaseClient();

    const { error } = await supabase.auth.signOut({ scope: "others" });
    if (error) {
      logger.error("sign_out_others_failed", { error: error.message });
      return { ok: false, message: "settings.devices.failed" };
    }

    await recordAuditEvent({
      actorId: user.id,
      action: "account.other_devices_revoked",
      targetType: "user",
      targetId: user.id,
      result: "success",
      metadata: {},
    });

    revalidatePath("/settings");
    return { ok: true, message: "settings.devices.othersRevoked" };
  } catch (error) {
    logger.error("sign_out_others_unexpected", { error: String(error) });
    return { ok: false, message: "settings.devices.failed" };
  }
}

/** Ends every session including this one. Used when a password is at risk. */
export async function signOutEverywhereAction(): Promise<{ ok: boolean }> {
  try {
    const user = await requireUser();
    const admin = createServiceRoleClient();
    const { error } = await admin.auth.admin.signOut(user.id, "global");

    await recordAuditEvent({
      actorId: user.id,
      action: "account.all_devices_revoked",
      targetType: "user",
      targetId: user.id,
      result: error ? "failure" : "success",
      metadata: {},
    });

    if (error) return { ok: false };

    const supabase = await createServerSupabaseClient();
    await supabase.auth.signOut();
    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
