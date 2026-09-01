/**
 * Spreadsheet parsing, isolated in a worker thread.
 *
 * ## Why this is not a plain function call
 *
 * The `xlsx` (SheetJS) package carries two unpatched high-severity
 * advisories at the last version published to npm (0.18.5):
 *
 *   - GHSA-4r6h-8v6p-xvw6 — prototype pollution
 *   - GHSA-5pgg-2g8v-p4x9 — regular-expression denial of service
 *
 * and this parser runs on files any authenticated user uploads. SheetJS
 * stopped publishing to the npm registry after 0.18.5, so `npm audit`
 * reports "No fix available"; the patched releases are distributed from
 * the vendor's own CDN. Upgrading is the real fix and is documented in
 * SECURITY.md — this module is the containment that holds either way.
 *
 * A worker thread is a **separate V8 isolate**. That is what makes it
 * work here:
 *
 *   - Prototype pollution inside the worker corrupts the *worker's*
 *     `Object.prototype`, not the server's. The worker is destroyed after
 *     one file, so the corruption dies with it.
 *   - `XLSX.read` is synchronous. A ReDoS input therefore blocks whatever
 *     thread it runs on, and an in-process `Promise.race` timeout cannot
 *     interrupt it — the timer callback can never be reached because the
 *     event loop is the thing being blocked. Off the main thread, the
 *     parse can be killed with `terminate()` and the server keeps serving.
 *
 * Only a string comes back across the boundary, so a polluted object
 * cannot be structured-cloned into the parent.
 */
import { Worker } from "node:worker_threads";
import { logger } from "@/lib/logger";

/** Hard ceiling on parse time. Beyond this the worker is killed. */
const PARSE_TIMEOUT_MS = 15_000;

/**
 * The worker body, inlined.
 *
 * Inline rather than a separate file because Next bundles and relocates
 * server code at build time, and a path to a `.ts` sibling does not
 * survive that. `src/files/processors/xlsx.ts` keeps the static
 * `import("xlsx")` that makes Next's dependency tracer include the
 * package in the deployment output; this string is what actually runs.
 */
const WORKER_SOURCE = `
const { parentPort, workerData } = require("node:worker_threads");
const XLSX = require("xlsx");

const MAX_SHEETS = 10;
const MAX_ROWS = 300;
const MAX_COLS = 50;

try {
  const workbook = XLSX.read(workerData.buffer, { type: "buffer", dense: true });
  const sections = [];

  for (const sheetName of workbook.SheetNames.slice(0, MAX_SHEETS)) {
    const sheet = workbook.Sheets[sheetName];
    if (!sheet) continue;

    const rows = XLSX.utils
      .sheet_to_json(sheet, { header: 1, blankrows: false })
      .slice(0, MAX_ROWS)
      .map((row) => (Array.isArray(row) ? row.slice(0, MAX_COLS) : []));

    if (rows.length === 0) continue;

    const header = rows[0].map(String);
    const body = rows.slice(1);
    const lines = [
      "## Sheet: " + String(sheetName),
      "| " + header.join(" | ") + " |",
      "| " + header.map(() => "---").join(" | ") + " |",
      ...body.map((row) => "| " + row.map((cell) => String(cell ?? "").replace(/\\|/g, "\\\\|")).join(" | ") + " |"),
    ];
    sections.push(lines.join("\\n"));
  }

  // A string, never an object: structured-cloning a parsed workbook back
  // to the parent would be a way for polluted properties to travel.
  parentPort.postMessage({ ok: true, text: sections.join("\\n\\n").slice(0, 200000) });
} catch (error) {
  parentPort.postMessage({ ok: false, error: String(error && error.message ? error.message : error) });
}
`;

export function parseXlsxIsolated(buffer: Buffer): Promise<string> {
  return new Promise((resolve, reject) => {
    let settled = false;

    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: { buffer },
      // No environment and no argv: the parser has no business reading
      // SUPABASE_SERVICE_ROLE_KEY or any other secret in this process.
      env: {},
      argv: [],
      resourceLimits: {
        // Caps a decompression bomb before it exhausts the host.
        maxOldGenerationSizeMb: 256,
      },
      // Resolve bare `require("xlsx")` against the app root rather than
      // against the eval'd script, which has no directory of its own.
      execArgv: [],
      stdout: true,
      stderr: true,
    });

    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      fn();
    };

    const timer = setTimeout(() => {
      logger.warn("xlsx_parse_timeout", { bytes: buffer.byteLength });
      finish(() => reject(new Error("Spreadsheet took too long to read")));
    }, PARSE_TIMEOUT_MS);

    worker.on("message", (message: { ok: boolean; text?: string; error?: string }) => {
      finish(() => {
        if (message.ok && typeof message.text === "string") resolve(message.text);
        else reject(new Error(message.error ?? "Could not read spreadsheet"));
      });
    });

    worker.on("error", (error) => {
      finish(() => reject(error));
    });

    worker.on("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`Spreadsheet reader exited with code ${code}`)));
    });
  });
}

export { PARSE_TIMEOUT_MS };
