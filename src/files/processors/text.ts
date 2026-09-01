/** Plain text / Markdown / RTF (RTF is treated as plain text — good enough for extraction, not full RTF parsing). */
export async function processText(buffer: Buffer): Promise<string> {
  return buffer.toString("utf-8").slice(0, 200_000);
}
