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
  return NextResponse.json({ conversations: data ?? [] });
}

export async function POST() {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("conversations")
    .insert({ user_id: user.id, title: "New conversation" })
    .select()
    .single();

  if (error || !data) return NextResponse.json({ error: "Could not create conversation" }, { status: 500 });
  return NextResponse.json({ conversation: data });
}
