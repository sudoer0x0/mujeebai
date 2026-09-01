import "server-only";
import { GatewayError } from "@/ai/types";

// File upload classification and validation.
export type FileKind =
  | "document"
  | "spreadsheet"
  | "presentation"
  | "image"
  | "audio"
  | "video"
  | "code"
  | "data"
  | "other";

interface FileTypeRule {
  kind: FileKind;
  extensions: string[];
  mimeTypes: string[];
}

const RULES: FileTypeRule[] = [
  { kind: "document", extensions: ["pdf"], mimeTypes: ["application/pdf"] },
  {
    kind: "document",
    extensions: ["docx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.wordprocessingml.document"],
  },
  { kind: "document", extensions: ["txt", "md", "rtf"], mimeTypes: ["text/plain", "text/markdown", "application/rtf"] },
  {
    kind: "spreadsheet",
    extensions: ["xlsx", "xls"],
    mimeTypes: [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
    ],
  },
  { kind: "spreadsheet", extensions: ["csv"], mimeTypes: ["text/csv"] },
  {
    kind: "presentation",
    extensions: ["pptx"],
    mimeTypes: ["application/vnd.openxmlformats-officedocument.presentationml.presentation"],
  },
  {
    kind: "image",
    extensions: ["png", "jpg", "jpeg", "webp", "gif"],
    mimeTypes: ["image/png", "image/jpeg", "image/webp", "image/gif"],
  },
  { kind: "data", extensions: ["json", "xml", "yaml", "yml", "sql"], mimeTypes: [] },
  {
    kind: "code",
    extensions: ["ts", "tsx", "js", "jsx", "py", "go", "rs", "java", "c", "cpp", "rb", "php", "sh"],
    mimeTypes: [],
  },
  { kind: "audio", extensions: ["mp3", "wav", "m4a", "ogg"], mimeTypes: ["audio/mpeg", "audio/wav", "audio/ogg"] },
  { kind: "video", extensions: ["mp4", "mov", "webm"], mimeTypes: ["video/mp4", "video/quicktime", "video/webm"] },
];

export function getExtension(filename: string): string {
  const parts = filename.toLowerCase().split(".");
  const raw = parts.length > 1 ? parts.pop()! : "";
  return raw.replace(/[^a-z0-9]/g, "");
}

// Strips path separators/control characters.
export function sanitizeFilename(filename: string): string {
  const base = filename.replace(/[/\\]/g, "_").replace(/[\x00-\x1f]/g, "");
  return base.slice(-180) || "file";
}

// Classifies file by extension and verifies declared MIME.
export function classifyFile(
  filename: string,
  mimeType: string | undefined,
): { kind: FileKind; canonicalMimeType: string } {
  const ext = getExtension(filename);
  const rule = RULES.find((r) => r.extensions.includes(ext));

  if (!rule) return { kind: "other", canonicalMimeType: "application/octet-stream" };

  if (rule.mimeTypes.length > 0 && mimeType && !rule.mimeTypes.includes(mimeType)) {
    return { kind: "other", canonicalMimeType: "application/octet-stream" };
  }

  return { kind: rule.kind, canonicalMimeType: rule.mimeTypes[0] ?? "application/octet-stream" };
}

/**
 * Inspects initial magic bytes of the raw buffer to ensure actual file
 * contents match the claimed format/kind, defending against spoofed extensions/MIME.
 */
export function validateMagicBytes(buffer: Buffer, kind: FileKind, extension: string): boolean {
  if (buffer.length === 0) return false;

  const ext = extension.toLowerCase();

  switch (ext) {
    case "pdf":
      // %PDF- (0x25 0x50 0x44 0x46)
      return buffer.length >= 5 && buffer.toString("ascii", 0, 5) === "%PDF-";

    case "png":
      // \x89PNG\r\n\x1a\n
      return (
        buffer.length >= 8 &&
        buffer[0] === 0x89 &&
        buffer[1] === 0x50 &&
        buffer[2] === 0x4e &&
        buffer[3] === 0x47 &&
        buffer[4] === 0x0d &&
        buffer[5] === 0x0a &&
        buffer[6] === 0x1a &&
        buffer[7] === 0x0a
      );

    case "jpg":
    case "jpeg":
      // \xFF\xD8\xFF
      return buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff;

    case "gif":
      // GIF87a or GIF89a
      if (buffer.length < 6) return false;
      const gifHeader = buffer.toString("ascii", 0, 6);
      return gifHeader === "GIF87a" || gifHeader === "GIF89a";

    case "webp":
      // RIFF....WEBP
      if (buffer.length < 12) return false;
      return (
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WEBP"
      );

    case "docx":
    case "pptx":
    case "xlsx":
      // PK\x03\x04 or PK\x05\x06 (ZIP archive signatures)
      if (buffer.length < 4) return false;
      return (
        buffer[0] === 0x50 &&
        buffer[1] === 0x4b &&
        ((buffer[2] === 0x03 && buffer[3] === 0x04) ||
          (buffer[2] === 0x05 && buffer[3] === 0x06) ||
          (buffer[2] === 0x07 && buffer[3] === 0x08))
      );

    case "xls":
      // OLECF (\xD0\xCF\x11\xE0\xA1\xB1\x1A\xE1) or ZIP
      if (buffer.length < 8) return false;
      const isOle =
        buffer[0] === 0xd0 &&
        buffer[1] === 0xcf &&
        buffer[2] === 0x11 &&
        buffer[3] === 0xe0 &&
        buffer[4] === 0xa1 &&
        buffer[5] === 0xb1 &&
        buffer[6] === 0x1a &&
        buffer[7] === 0xe1;
      const isZip = buffer[0] === 0x50 && buffer[1] === 0x4b;
      return isOle || isZip;

    case "mp3":
      if (buffer.length < 3) return false;
      const hasId3 = buffer.toString("ascii", 0, 3) === "ID3";
      const hasSync = (buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0);
      return hasId3 || hasSync;

    case "wav":
      return (
        buffer.length >= 12 &&
        buffer.toString("ascii", 0, 4) === "RIFF" &&
        buffer.toString("ascii", 8, 12) === "WAVE"
      );

    case "ogg":
      return buffer.length >= 4 && buffer.toString("ascii", 0, 4) === "OggS";

    case "mp4":
    case "mov":
      if (buffer.length < 8) return false;
      const ftyp = buffer.toString("ascii", 4, 8);
      return ftyp === "ftyp" || ftyp === "moov" || ftyp === "mdat";

    case "webm":
      return (
        buffer.length >= 4 &&
        buffer[0] === 0x1a &&
        buffer[1] === 0x45 &&
        buffer[2] === 0xdf &&
        buffer[3] === 0xa3
      );

    default:
      // Text / CSV / Code / Data formats: reject binary null bytes in initial chunk
      if (kind === "document" || kind === "spreadsheet" || kind === "code" || kind === "data") {
        const sampleLength = Math.min(buffer.length, 1024);
        for (let i = 0; i < sampleLength; i++) {
          if (buffer[i] === 0x00) return false;
        }
        return true;
      }
      return true;
  }
}

export interface FileValidationInput {
  filename: string;
  mimeType: string | undefined;
  sizeBytes: number;
  maxSizeBytes: number;
  buffer?: Buffer;
}

export function validateFile({ filename, mimeType, sizeBytes, maxSizeBytes, buffer }: FileValidationInput) {
  const sanitizedFilename = sanitizeFilename(filename);
  const { kind, canonicalMimeType } = classifyFile(sanitizedFilename, mimeType);

  if (kind === "other") {
    throw new GatewayError("invalid_request", "files.unsupported");
  }

  if (sizeBytes <= 0) {
    throw new GatewayError("invalid_request", "Empty file.");
  }

  if (sizeBytes > maxSizeBytes) {
    throw new GatewayError("invalid_request", "files.tooLarge");
  }

  const ext = getExtension(sanitizedFilename);
  if (buffer && !validateMagicBytes(buffer, kind, ext)) {
    throw new GatewayError("invalid_request", "files.unsupported");
  }

  return { kind, sanitizedFilename, canonicalMimeType };
}
