import { PDFParse } from "pdf-parse";

// PDF text extraction.
export async function processPdf(buffer: Buffer): Promise<string> {
  const parser = new PDFParse({ data: new Uint8Array(buffer) });
  try {
    const result = await parser.getText();
    const text = result.text?.trim();
    if (!text) return "(no extractable text — this PDF may be a scanned image without OCR support yet)";
    return text.slice(0, 200_000);
  } finally {
    await parser.destroy();
  }
}
