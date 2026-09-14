import { NextResponse } from "next/server";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dbErrorResponse } from "@/lib/api-errors";

export async function GET() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .select("id, title, is_archived, is_pinned, last_message_at, created_at, model_id")
    .eq("user_id", user.id)
    .order("is_pinned", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return dbErrorResponse("conversations_list_failed", error);

  // Sort pinned first, then by most recent activity (max of last_message_at or created_at)
  const sorted = (data ?? []).slice().sort((a, b) => {
    if (a.is_pinned !== b.is_pinned) {
      return a.is_pinned ? -1 : 1;
    }
    const timeA = Math.max(new Date(a.last_message_at ?? 0).getTime(), new Date(a.created_at).getTime());
    const timeB = Math.max(new Date(b.last_message_at ?? 0).getTime(), new Date(b.created_at).getTime());
    return timeB - timeA;
  });

  return NextResponse.json({ conversations: sorted });
}

import { logger } from "@/lib/logger";

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  let { data, error } = await supabase
    .from("conversations")
    .insert({
      user_id: user.id,
      title: "New conversation",
      last_message_at: new Date().toISOString(),
    })
    .select()
    .single();

  if (error || !data) {
    logger.warn("conversation_create_anon_failed_retrying_service_role", {
      error: error?.message,
      userId: user.id,
    });
    try {
      const { createServiceRoleClient } = await import("@/lib/supabase/server");
      const serviceRole = createServiceRoleClient();

      const { data: profile } = await serviceRole.from("profiles").select("id").eq("id", user.id).maybeSingle();
      if (!profile) {
        await serviceRole.from("profiles").insert({
          id: user.id,
          email: user.email ?? `user_${user.id.slice(0, 8)}@example.com`,
          display_name: user.email?.split("@")[0] ?? "User",
          role: "user",
          status: "active",
        });
      }

      const retry = await serviceRole
        .from("conversations")
        .insert({
          user_id: user.id,
          title: "New conversation",
          last_message_at: new Date().toISOString(),
        })
        .select()
        .single();
      data = retry.data;
      error = retry.error;
    } catch (retryErr) {
      logger.error("conversation_creation_service_role_retry_failed", {
        error: String(retryErr),
        userId: user.id,
      });
    }
  }

  if (error || !data) {
    logger.error("conversation_creation_failed", { error: error?.message, userId: user.id });
    return NextResponse.json({ error: "Could not create conversation" }, { status: 500 });
  }
  return NextResponse.json({ conversation: data });
}
