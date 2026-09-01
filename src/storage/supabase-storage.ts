import "server-only";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { GetUrlOptions, StorageAdapter, StorageMetadata, UploadOptions } from "@/storage/types";

const BUCKET = "mujeeb-files";

// Supabase Storage implementation.
export function createSupabaseStorageAdapter(): StorageAdapter {
  return {
    slug: "supabase",

    async upload(path, data, options?: UploadOptions) {
      const supabase = createServiceRoleClient();
      const { error } = await supabase.storage.from(BUCKET).upload(path, data, {
        contentType: options?.contentType,
        upsert: false,
      });
      if (error) throw new Error(`Supabase Storage upload failed: ${error.message}`);
      return { path };
    },

    async download(path) {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase.storage.from(BUCKET).download(path);
      if (error || !data) throw new Error(`Supabase Storage download failed: ${error?.message}`);
      return Buffer.from(await data.arrayBuffer());
    },

    async delete(path) {
      const supabase = createServiceRoleClient();
      const { error } = await supabase.storage.from(BUCKET).remove([path]);
      if (error) throw new Error(`Supabase Storage delete failed: ${error.message}`);
    },

    async exists(path) {
      const supabase = createServiceRoleClient();
      const dir = path.split("/").slice(0, -1).join("/");
      const filename = path.split("/").pop()!;
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: filename });
      if (error) return false;
      return (data ?? []).some((f) => f.name === filename);
    },

    async getUrl(path, options?: GetUrlOptions) {
      const supabase = createServiceRoleClient();
      const { data, error } = await supabase.storage
        .from(BUCKET)
        .createSignedUrl(path, options?.expiresInSeconds ?? 3600);
      if (error || !data) throw new Error(`Supabase Storage signed URL failed: ${error?.message}`);
      return data.signedUrl;
    },

    async getMetadata(path): Promise<StorageMetadata | null> {
      const supabase = createServiceRoleClient();
      const dir = path.split("/").slice(0, -1).join("/");
      const filename = path.split("/").pop()!;
      const { data, error } = await supabase.storage.from(BUCKET).list(dir, { search: filename });
      if (error || !data?.[0]) return null;
      const file = data[0];
      return {
        size: file.metadata?.size ?? 0,
        contentType: file.metadata?.mimetype,
        lastModified: file.updated_at ?? undefined,
      };
    },
  };
}
