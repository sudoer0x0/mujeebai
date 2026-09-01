"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

/**
 * The "you're on Pro now" notice.
 *
 * Backed by the `notifications` table rather than by browser storage, for
 * two reasons: a purchase confirmed on a phone should not reappear on a
 * laptop, and support needs to be able to see that the confirmation was
 * actually delivered when someone says they were charged and nothing
 * happened.
 */

export interface PlanNotice {
  id: string;
  kind: "granted" | "purchased";
  planName: string;
  expiresAt: string | null;
  days: number | null;
}

/** The most recent unread plan notice, if there is one. */
export async function getPlanNotice(userId: string): Promise<PlanNotice | null> {
  try {
    const supabase = await createServerSupabaseClient();
    const { data } = await supabase
      .from("notifications")
      .select("id, type, title, metadata, created_at")
      .eq("user_id", userId)
      .in("type", ["plan_granted", "plan_purchased"])
      .is("read_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!data) return null;

    const meta = (data.metadata ?? {}) as { planName?: string; expiresAt?: string; days?: number };

    return {
      id: data.id,
      kind: data.type === "plan_granted" ? "granted" : "purchased",
      planName: meta.planName ?? data.title,
      expiresAt: meta.expiresAt ?? null,
      days: typeof meta.days === "number" ? meta.days : null,
    };
  } catch (error) {
    // A notice is never worth failing a page render over.
    logger.warn("plan_notice_load_failed", { error: String(error) });
    return null;
  }
}

const schema = z.object({ id: z.string().uuid() });

/** Marks the notice read, so it does not come back on the next page. */
export async function dismissPlanNoticeAction(input: unknown): Promise<{ ok: boolean }> {
  try {
    const user = await requireUser();
    const parsed = schema.safeParse(input);
    if (!parsed.success) return { ok: false };

    const supabase = await createServerSupabaseClient();
    // Scoped to the caller as well as by RLS — a notification id is a
    // UUID a client supplies, and one gate should never be the only one.
    const { error } = await supabase
      .from("notifications")
      .update({ read_at: new Date().toISOString() })
      .eq("id", parsed.data.id)
      .eq("user_id", user.id);

    if (error) return { ok: false };

    revalidatePath("/", "layout");
    return { ok: true };
  } catch {
    return { ok: false };
  }
}
