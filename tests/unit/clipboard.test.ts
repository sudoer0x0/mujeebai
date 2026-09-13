import test from "node:test";
import assert from "node:assert/strict";
import { extractFilesFromClipboard, normalizePastedFile } from "@/lib/clipboard";

test("extractFilesFromClipboard returns empty array for null, empty or text-only data", () => {
  assert.deepEqual(extractFilesFromClipboard(null), []);

  // Empty data
  const emptyData = { files: [], items: [] } as unknown as DataTransfer;
  assert.deepEqual(extractFilesFromClipboard(emptyData), []);

  // Text-only clipboard data (common string paste)
  const textData = {
    files: [] as unknown as FileList,
    items: [
      { kind: "string", type: "text/plain" },
      { kind: "string", type: "text/html" },
    ],
  } as unknown as DataTransfer;
  assert.deepEqual(extractFilesFromClipboard(textData), []);
});

test("extractFilesFromClipboard extracts files from clipboardData.files", () => {
  const file1 = new File(["dummy pdf"], "annual-report.pdf", { type: "application/pdf" });
  const file2 = new File(["dummy png"], "chart.png", { type: "image/png" });

  const transfer = {
    files: [file1, file2],
    items: [],
  } as unknown as DataTransfer;

  const result = extractFilesFromClipboard(transfer);
  assert.equal(result.length, 2);
  assert.equal(result[0].name, "annual-report.pdf");
  assert.equal(result[1].name, "chart.png");
});

test("extractFilesFromClipboard falls back to items when files list is empty", () => {
  const screenshot = new File(["screenshot data"], "image.png", { type: "image/png" });

  const transfer = {
    files: [] as unknown as FileList,
    items: [
      {
        kind: "file",
        type: "image/png",
        getAsFile: () => screenshot,
      },
    ],
  } as unknown as DataTransfer;

  const result = extractFilesFromClipboard(transfer);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "image.png");
  assert.equal(result[0].type, "image/png");
});

test("extractFilesFromClipboard does not duplicate files if both files and items are present", () => {
  const file1 = new File(["data"], "invoice.pdf", { type: "application/pdf" });

  const transfer = {
    files: [file1],
    items: [
      {
        kind: "file",
        type: "application/pdf",
        getAsFile: () => file1,
      },
    ],
  } as unknown as DataTransfer;

  const result = extractFilesFromClipboard(transfer);
  assert.equal(result.length, 1);
  assert.equal(result[0].name, "invoice.pdf");
});

test("normalizePastedFile preserves legitimate filenames and extensions", () => {
  const file = new File(["content"], "notes.txt", { type: "text/plain" });
  const normalized = normalizePastedFile(file);
  assert.equal(normalized.name, "notes.txt");
});

test("normalizePastedFile appends canonical extension to bare blob or extensionless names", () => {
  // Bare "blob" image
  const blobImage = new File(["png data"], "blob", { type: "image/png" });
  const normalizedBlob = normalizePastedFile(blobImage);
  assert.ok(normalizedBlob.name.endsWith(".png"), "Should end with .png");
  assert.equal(normalizedBlob.type, "image/png");

  // Extensionless document name
  const extensionlessPdf = new File(["pdf data"], "contract", { type: "application/pdf" });
  const normalizedPdf = normalizePastedFile(extensionlessPdf);
  assert.equal(normalizedPdf.name, "contract.pdf");

  // Bare empty name
  const emptyNameJpg = new File(["jpg data"], "", { type: "image/jpeg" });
  const normalizedJpg = normalizePastedFile(emptyNameJpg);
  assert.ok(normalizedJpg.name.endsWith(".jpg"));
});
