import { NextResponse } from "next/server";
import { z } from "zod";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { createStorageAdapter } from "@/storage/factory";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";

/**
 * Stable URL for a stored asset.
 *
 * Generated images used to be persisted into message content as a
 * one-hour signed storage URL, so every generated image in a user's
 * history silently broke an hour after it was made. Messages now store
 * `/api/assets/<id>`, and this route mints a fresh signed URL on each
 * request.
 *
 * Ownership is re-checked here on every request — the asset id is a
 * guessable-shaped identifier and must never be sufficient on its own to
 * read someone else's file (#50, IDOR).
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
  const { data: asset } = await supabase
    .from("generated_assets")
    .select("storage_path, owner_id")
    .eq("id", parsed.data)
    .eq("owner_id", user.id)
    .maybeSingle();

  // Same response whether the asset does not exist or belongs to someone
  // else, so this cannot be used to probe for valid ids.
  if (!asset) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    const storage = createStorageAdapter();
    const url = await storage.getUrl(asset.storage_path, { expiresInSeconds: 3600 });
    return NextResponse.redirect(url, {
      // Private: the redirect target is a short-lived signed URL scoped to
      // one user, and must never be held in a shared cache.
      headers: { "Cache-Control": "private, max-age=600" },
    });
  } catch (error) {
    logger.error("asset_url_failed", { assetId: parsed.data, error: String(error) });
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }
}
