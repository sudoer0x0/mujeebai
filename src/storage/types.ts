// Storage interface contract.
export interface UploadOptions {
  contentType?: string;
  /** true for content that should never be publicly reachable without a signed URL (the default posture). */
  private?: boolean;
}

export interface GetUrlOptions {
  expiresInSeconds?: number;
}

export interface StorageMetadata {
  size: number;
  contentType?: string;
  lastModified?: string;
}

export interface StorageAdapter {
  slug: string;
  upload(path: string, data: Buffer | Uint8Array, options?: UploadOptions): Promise<{ path: string }>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getUrl(path: string, options?: GetUrlOptions): Promise<string>;
  getMetadata(path: string): Promise<StorageMetadata | null>;
}
