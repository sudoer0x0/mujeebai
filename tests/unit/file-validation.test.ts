import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyFile,
  sanitizeFilename,
  validateMagicBytes,
  validateFile,
} from "@/files/validate";
import { parseCsv } from "@/files/processors/csv";

test("file validation: classifyFile detects matching extension and MIME type", () => {
  const pdf = classifyFile("document.pdf", "application/pdf");
  assert.equal(pdf.kind, "document");
  assert.equal(pdf.canonicalMimeType, "application/pdf");

  const docx = classifyFile("report.docx", "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
  assert.equal(docx.kind, "document");

  const png = classifyFile("photo.png", "image/png");
  assert.equal(png.kind, "image");
  assert.equal(png.canonicalMimeType, "image/png");

  const csv = classifyFile("data.csv", "text/csv");
  assert.equal(csv.kind, "spreadsheet");
});

test("file validation: classifyFile rejects mismatched extension and MIME type", () => {
  // Mismatched declared MIME vs extension
  const spoofedPdf = classifyFile("script.pdf", "text/html");
  assert.equal(spoofedPdf.kind, "other");

  const spoofedPng = classifyFile("malicious.png", "application/x-msdownload");
  assert.equal(spoofedPng.kind, "other");
});

test("file validation: sanitizeFilename strips directory traversal and control characters", () => {
  assert.equal(sanitizeFilename("../../../etc/passwd"), ".._.._.._etc_passwd");
  assert.equal(sanitizeFilename("folder\\subfolder\\file.txt"), "folder_subfolder_file.txt");
  assert.equal(sanitizeFilename("file\x00with\x1fnull.pdf"), "filewithnull.pdf");
});

test("file validation: validateMagicBytes detects valid vs spoofed content", () => {
  // PDF
  const validPdf = Buffer.from("%PDF-1.7 header content here");
  assert.equal(validateMagicBytes(validPdf, "document", "pdf"), true);

  const fakePdf = Buffer.from("<html>not a real pdf</html>");
  assert.equal(validateMagicBytes(fakePdf, "document", "pdf"), false);

  // PNG
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00]);
  assert.equal(validateMagicBytes(validPng, "image", "png"), true);

  const fakePng = Buffer.from("GIF89a not a png");
  assert.equal(validateMagicBytes(fakePng, "image", "png"), false);

  // JPEG
  const validJpg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00]);
  assert.equal(validateMagicBytes(validJpg, "image", "jpg"), true);

  // Office ZIP (DOCX / PPTX / XLSX)
  const validZip = Buffer.from([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]);
  assert.equal(validateMagicBytes(validZip, "document", "docx"), true);
  assert.equal(validateMagicBytes(validZip, "presentation", "pptx"), true);
  assert.equal(validateMagicBytes(validZip, "spreadsheet", "xlsx"), true);

  const fakeDocx = Buffer.from("This is plain text pretending to be docx");
  assert.equal(validateMagicBytes(fakeDocx, "document", "docx"), false);

  // Text with null bytes rejected
  const binaryAsText = Buffer.from([0x48, 0x65, 0x6c, 0x00, 0x6f]);
  assert.equal(validateMagicBytes(binaryAsText, "document", "txt"), false);
});

test("file validation: validateFile integrates checks end-to-end", () => {
  const validPdfBuffer = Buffer.from("%PDF-1.4 sample content");
  const result = validateFile({
    filename: "report.pdf",
    mimeType: "application/pdf",
    sizeBytes: validPdfBuffer.length,
    maxSizeBytes: 10 * 1024 * 1024,
    buffer: validPdfBuffer,
  });

  assert.equal(result.kind, "document");
  assert.equal(result.canonicalMimeType, "application/pdf");
  assert.equal(result.sanitizedFilename, "report.pdf");
});

test("file processors: parseCsv handles RFC 4180 quotes, commas, and escapes", () => {
  const csvContent = `name,role,description
"Alice","Engineer","Loves coding, debugging"
"Bob","Manager","Says ""hello world"""
"Charlie","Analyst","Simple string"`;

  const parsed = parseCsv(csvContent);
  assert.equal(parsed.length, 4);
  assert.deepEqual(parsed[0], ["name", "role", "description"]);
  assert.deepEqual(parsed[1], ["Alice", "Engineer", "Loves coding, debugging"]);
  assert.deepEqual(parsed[2], ["Bob", "Manager", 'Says "hello world"']);
  assert.deepEqual(parsed[3], ["Charlie", "Analyst", "Simple string"]);
});
