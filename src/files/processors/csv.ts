// RFC 4180 CSV parser.
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    const nextChar = text[i + 1];

    if (inQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          currentField += '"';
          i++; // skip escaped quote
        } else {
          inQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        inQuotes = true;
      } else if (char === ",") {
        currentRow.push(currentField.trim());
        currentField = "";
      } else if (char === "\r") {
        if (nextChar === "\n") i++;
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else if (char === "\n") {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) rows.push(currentRow);
        currentRow = [];
        currentField = "";
      } else {
        currentField += char;
      }
    }
  }

  if (currentField || currentRow.length > 0) {
    currentRow.push(currentField.trim());
    if (currentRow.some((f) => f.length > 0)) rows.push(currentRow);
  }

  return rows;
}

// Formats CSV buffer to markdown table.
export async function processCsv(buffer: Buffer): Promise<string> {
  const text = buffer.toString("utf-8");
  const allRows = parseCsv(text);

  if (allRows.length === 0) return "(empty CSV)";

  const maxCols = 50;
  const rows = allRows.slice(0, 300).map((r) => r.slice(0, maxCols));
  const header = rows[0].map((cell) => cell.replace(/\|/g, "\\|"));
  const body = rows.slice(1, 200);

  const lines = [
    `| ${header.join(" | ")} |`,
    `| ${header.map(() => "---").join(" | ")} |`,
    ...body.map((row) => `| ${row.map((cell) => cell.replace(/\|/g, "\\|")).join(" | ")} |`),
  ];

  if (allRows.length > 200) {
    lines.push(`\n(${allRows.length - 200} additional rows truncated)`);
  }

  return lines.join("\n");
}
