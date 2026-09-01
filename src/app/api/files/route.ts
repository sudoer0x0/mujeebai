import { NextResponse } from "next/server";
import { nanoid } from "nanoid";
import { requireUser } from "@/auth/session";
import { createServerSupabaseClient } from "@/lib/supabase/server";
import { getEffectiveNumber } from "@/billing/entitlements";
import { consumeQuota } from "@/usage/quota";
import { getExtension, validateFile } from "@/files/validate";
import { processFile } from "@/files/processors";
import { createStorageAdapter } from "@/storage/factory";
import { GatewayError } from "@/ai/types";
import { logger } from "@/lib/logger";
import { checkRateLimit } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const maxDuration = 60;

// File upload and processing endpoint.
export async function POST(request: Request) {
  let user;
  try {
    user = await requireUser();
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const rateLimit = checkRateLimit(`files:${user.id}`, 20, 60_000);
  if (!rateLimit.allowed) return NextResponse.json({ error: "files.failed" }, { status: 429 });

  const maxSizeMb = await getEffectiveNumber(user.id, "max_file_size_mb", 10);
  const maxSizeBytes = maxSizeMb * 1024 * 1024;

  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > maxSizeBytes + 64 * 1024) {
    return NextResponse.json({ error: "files.tooLarge" }, { status: 413 });
  }

  const formData = await request.formData();
  const file = formData.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "No file provided" }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  let validated;
  try {
    validated = validateFile({
      filename: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      maxSizeBytes,
      buffer,
    });
  } catch (error) {
    if (error instanceof GatewayError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }
    throw error;
  }

  try {
    await consumeQuota(user.id, "file_processing");
  } catch {
    return NextResponse.json({ error: "chat.quotaReached.title" }, { status: 429 });
  }

  const supabase = await createServerSupabaseClient();
  const extension = getExtension(validated.sanitizedFilename);
  const storagePath = `${user.id}/${nanoid()}.${extension || "bin"}`;

  const { data: attachment, error: insertError } = await supabase
    .from("attachments")
    .insert({
      owner_id: user.id,
      storage_path: storagePath,
      original_filename: validated.sanitizedFilename,
      // The server-derived canonical MIME type, never the client-declared
      // `file.type` — see classifyFile()'s doc comment in
      // src/files/validate.ts for why.
      mime_type: validated.canonicalMimeType,
      size_bytes: file.size,
      kind: validated.kind,
      status: "uploading",
    })
    .select()
    .single();

  if (insertError || !attachment) {
    return NextResponse.json({ error: "Could not create attachment record" }, { status: 500 });
  }

  try {
    const storage = createStorageAdapter();
    await storage.upload(storagePath, buffer, { contentType: validated.canonicalMimeType, private: true });

    await supabase.from("attachments").update({ status: "processing" }).eq("id", attachment.id);

    const result = await processFile(validated.kind, extension, buffer);

    if ("error" in result && result.error) {
      await supabase
        .from("attachments")
        .update({ status: "failed", processing_error: result.error })
        .eq("id", attachment.id);
      return NextResponse.json({ error: result.error, attachmentId: attachment.id }, { status: 422 });
    }

    await supabase
      .from("attachments")
      .update({ status: "ready", processed_content: result.content ?? null })
      .eq("id", attachment.id);

    return NextResponse.json({
      id: attachment.id,
      filename: validated.sanitizedFilename,
      kind: validated.kind,
      status: "ready",
    });
  } catch (error) {
    logger.error("file_upload_failed", { error: String(error), attachmentId: attachment.id });
    await supabase
      .from("attachments")
      .update({ status: "failed", processing_error: "files.failed" })
      .eq("id", attachment.id);
    return NextResponse.json({ error: "files.failed", attachmentId: attachment.id }, { status: 500 });
  }
}
