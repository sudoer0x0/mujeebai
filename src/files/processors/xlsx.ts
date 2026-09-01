// XLSX to markdown tables.
//
// The parse itself runs in a worker thread — see xlsx-worker.ts for why
// (unpatched prototype-pollution and ReDoS advisories in the last npm
// release of SheetJS, applied to user-uploaded files).
//
// The `import("xlsx")` below is never executed. It exists so Next's
// dependency tracer sees the package as a real dependency of this route
// and includes it in the deployment output; the worker's
// `require("xlsx")` lives inside a string, which the tracer cannot read.
import { parseXlsxIsolated } from "./xlsx-worker";

/** @internal Present for Next's dependency tracing. Do not remove. */
export const __xlsxTracingAnchor = () => import("xlsx");

export async function processXlsx(buffer: Buffer): Promise<string> {
  const text = await parseXlsxIsolated(buffer);
  return text || "(empty workbook)";
}
