import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import type { UpdateOf } from "@/types/database";
import { dbErrorResponse } from "@/lib/api-errors";

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  isArchived: z.boolean().optional(),
  isPinned: z.boolean().optional(),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request" }, { status: 400 });

  const supabase = await createServerSupabaseClient();
  const update: UpdateOf<"conversations"> = {};
  if (parsed.data.title !== undefined) update.title = parsed.data.title;
  if (parsed.data.isArchived !== undefined) update.is_archived = parsed.data.isArchived;
  if (parsed.data.isPinned !== undefined) update.is_pinned = parsed.data.isPinned;

  const { data, error } = await supabase
    .from("conversations")
    .update(update)
    .eq("id", id)
    .eq("user_id", user.id)
    .select()
    .maybeSingle();

  if (error) return dbErrorResponse("conversation_patch_failed", error);
  if (!data) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ conversation: data });
}

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  // `.select()` so the number of affected rows is knowable. Without it the
  // handler answered `{ ok: true }` whether it deleted a conversation, hit
  // one belonging to somebody else, or matched nothing at all — a success
  // report that had not checked whether anything succeeded.
  //
  // The `user_id` filter already made the operation safe (and RLS refuses
  // it a second time), so this is about telling the truth rather than
  // about access. 404 covers both "not yours" and "does not exist", which
  // is deliberate: distinguishing them would confirm to a stranger that a
  // given conversation id exists.
  const { data, error } = await supabase
    .from("conversations")
    .delete()
    .eq("id", id)
    .eq("user_id", user.id)
    .select("id");

  if (error) return dbErrorResponse("conversation_delete_failed", error);
  if (!data || data.length === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
