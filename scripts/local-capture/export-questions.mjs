/**
 * Export the voice guide's anonymous question log (D1 table question_log) to a CSV file.
 *
 *   node export-questions.mjs
 *
 * Runs one fixed, read-only SELECT against the remote D1 database with wrangler (log in first with
 * `npx wrangler login`) and writes question-exports/questions-<UTC timestamp>.csv next to this
 * script. That folder is gitignored. An existing file is never overwritten.
 * Columns: day, input, question. The random row id is left out.
 */
import { execFile } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const DATABASE = "ai-portal-library";
const REPO_ROOT = fileURLToPath(new URL("../../", import.meta.url));
export const OUT_DIR = fileURLToPath(new URL("./question-exports/", import.meta.url));

// The only query this script runs. It never takes SQL from the command line.
export const QUERY = "SELECT day, input, question FROM question_log ORDER BY day, id";
export const COLUMNS = ["day", "input", "question"];

/** One CSV cell: quoted, with quotes doubled; a leading = + - @ is prefixed with ' so spreadsheets don't run it. */
export function csvCell(value) {
  let s = String(value ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export function toCsv(rows) {
  const lines = [COLUMNS.join(",")];
  for (const row of rows) lines.push(COLUMNS.map((c) => csvCell(row[c])).join(","));
  return lines.join("\r\n") + "\r\n";
}

/** The rows from `wrangler d1 execute --json` output. */
export function parseWranglerJson(stdout) {
  const parsed = JSON.parse(stdout);
  const results = Array.isArray(parsed) ? parsed : [parsed];
  if (results.some((r) => r.success === false)) throw new Error("the D1 query failed");
  return results.flatMap((r) => r.results ?? []);
}

async function main() {
  const { stdout } = await promisify(execFile)(
    "npx",
    ["wrangler", "d1", "execute", DATABASE, "--remote", "--json", "--command", QUERY],
    { cwd: REPO_ROOT, maxBuffer: 256 * 1024 * 1024 },
  );
  const rows = parseWranglerJson(stdout);
  await mkdir(OUT_DIR, { recursive: true });
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
  const file = `${OUT_DIR}questions-${stamp}.csv`;
  await writeFile(file, toCsv(rows), { flag: "wx" });
  console.log(`Wrote ${rows.length} question${rows.length === 1 ? "" : "s"} to ${file}`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
}
