/**
 * Utilities for inspecting and normalizing clipboard data during paste events.
 *
 * Handles both `clipboardData.files` (Finder/Explorer file copies) and
 * `clipboardData.items` (direct OS screenshot clippings or cross-app image copies).
 */

const MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/webp": "webp",
  "image/gif": "gif",
  "application/pdf": "pdf",
  "text/plain": "txt",
  "text/csv": "csv",
  "application/json": "json",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
};

/**
 * Normalizes a pasted File object.
 *
 * Browsers and OS clipboards often label pasted screenshots as `image.png`
 * or bare `blob` without an extension. If the file has no valid file extension,
 * this synthesizes a timestamped filename with the canonical extension derived
 * from the file's MIME type so backend validators and file parsers can recognize it.
 */
export function normalizePastedFile(file: File): File {
  const name = file.name || "";
  const dotIndex = name.lastIndexOf(".");
  const hasValidExt = dotIndex > 0 && dotIndex < name.length - 1;

  if (hasValidExt) {
    return file;
  }

  const ext = MIME_TO_EXTENSION[file.type.toLowerCase()] || "png";
  const baseName = name && name !== "blob" ? name : `pasted-${Date.now()}`;
  const filename = `${baseName}.${ext}`;

  try {
    return new File([file], filename, {
      type: file.type || "image/png",
      lastModified: file.lastModified || Date.now(),
    });
  } catch {
    // In environments where File constructor is restricted, return the original file
    return file;
  }
}

/**
 * Extracts all File objects from a ClipboardData / DataTransfer object.
 *
 * Returns an empty array if the clipboard contains only text or string items,
 * allowing standard text pasting into textareas to proceed without interruption.
 */
export function extractFilesFromClipboard(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];

  const files: File[] = [];

  // 1. Direct files from clipboardData.files (e.g. copied from Finder or desktop)
  if (clipboardData.files && clipboardData.files.length > 0) {
    for (let i = 0; i < clipboardData.files.length; i++) {
      const file = clipboardData.files[i];
      if (file) {
        files.push(normalizePastedFile(file));
      }
    }
  }

  // 2. Fallback to clipboardData.items for items of kind "file" (e.g. pasted screenshots)
  // Only evaluate items if files list was empty to prevent duplicates on browsers where both are populated.
  if (files.length === 0 && clipboardData.items && clipboardData.items.length > 0) {
    for (let i = 0; i < clipboardData.items.length; i++) {
      const item = clipboardData.items[i];
      if (item && item.kind === "file") {
        const file = item.getAsFile();
        if (file) {
          files.push(normalizePastedFile(file));
        }
      }
    }
  }

  return files;
}
