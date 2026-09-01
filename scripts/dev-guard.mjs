/**
 * Refuses to start a second dev server against this project.
 *
 * Two `next dev` processes share one `distDir`, and they overwrite each
 * other's module graph as they compile. The symptom is not a helpful
 * error — it is `__webpack_modules__[moduleId] is not a function` thrown
 * from a random file, which reads as a bug in that file. It cost a
 * debugging session, so it is caught here instead.
 *
 * The check is deliberately conservative: it only refuses when it finds a
 * `next dev` for *this exact directory*. A dev server for another project
 * is none of our business, and a false positive that blocks work would be
 * worse than the problem.
 */
import { execSync } from "node:child_process";

const projectDir = process.cwd();
const self = process.pid;

function runningDevServers() {
  try {
    // `ps -eo pid=,command=` avoids a header row to skip.
    const out = execSync("ps -eo pid=,command=", { encoding: "utf8" });
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const [pid, ...rest] = line.split(/\s+/);
        return { pid: Number(pid), command: rest.join(" ") };
      })
      .filter(
        ({ pid, command }) =>
          pid !== self &&
          pid !== process.ppid &&
          // The launcher process, not the compiled server or a worker.
          /[/\s]next(\.js)?\s+dev\b|\.bin\/next\s+dev\b/.test(command) &&
          command.includes(projectDir),
      );
  } catch {
    // If `ps` is unavailable, do not block the developer.
    return [];
  }
}

const existing = runningDevServers();

if (existing.length > 0) {
  const list = existing.map(({ pid }) => `  pid ${pid}`).join("\n");
  console.error(
    [
      "",
      "  A dev server is already running for this project:",
      list,
      "",
      "  Two of them share one .next-dev directory and corrupt each other's",
      "  build cache. The symptom is a webpack error thrown from an unrelated",
      "  file, so this refuses to start rather than let that happen.",
      "",
      "  Stop the other one, or if it is a leftover:",
      "",
      "    pkill -f 'next dev' && npm run dev:clean",
      "",
    ].join("\n"),
  );
  process.exit(1);
}
