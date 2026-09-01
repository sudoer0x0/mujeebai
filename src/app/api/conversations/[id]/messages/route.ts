import { NextResponse } from "next/server";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { dbErrorResponse } from "@/lib/api-errors";
import { loadConversationMessages } from "@/chat/messages";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();

  const { data: conversation } = await supabase
    .from("conversations")
    .select("id")
    .eq("id", id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const messages = await loadConversationMessages(id);
    return NextResponse.json({ messages });
  } catch (error) {
    return dbErrorResponse("conversation_messages_failed", { message: String(error) });
  }
}
