import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createStorageAdapter } from "@/storage/factory";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Stable URL for a user's uploaded attachment.
 *
 * Uploads live in a private bucket, so they can only be read through a
 * short-lived signed URL. Persisting one of those into a message would
 * break the image an hour later — the same trap generated images fell
 * into — so messages reference `/api/attachments/<id>` and this route
 * mints a fresh signed URL per request.
 *
 * Ownership is re-checked every time: an attachment id must never be
 * sufficient on its own to read someone else's file.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;

  const parsed = z.string().uuid().safeParse(id);
  if (!parsed.success) return NextResponse.json({ error: "Not found" }, { status: 404 });

  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerSupabaseClient();
  const { data: attachment } = await supabase
    .from("attachments")
    .select("storage_path, owner_id")
    .eq("id", parsed.data)
    .eq("owner_id", user.id)
    .maybeSingle();

  // Identical response whether it does not exist or belongs to someone
  // else, so this cannot be used to probe for valid ids.
  if (!attachment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const storage = createStorageAdapter();
    const url = await storage.getUrl(attachment.storage_path, { expiresInSeconds: 3600 });
    return NextResponse.redirect(url, {
      // Private: the target is a signed URL scoped to one user and must
      // never sit in a shared cache.
      headers: { "Cache-Control": "private, max-age=600" },
    });
  } catch (error) {
    logger.error("attachment_url_failed", { attachmentId: parsed.data, error: String(error) });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
