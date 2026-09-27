/**
 * Screenshot safety (CLAUDE.md): never delete or overwrite an image file.
 * Used by prepare.mjs to write current.png / previous.png without losing an earlier download.
 */
import { existsSync } from "node:fs";
import { rename, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";

/** UTC timestamp suffix, e.g. 20260927T004512Z (same format as ~/AI-Surface-Archive). */
export function utcStamp(now = new Date()) {
  return now.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * If `file` exists, rename it to `<name>.<UTC timestamp><ext>` (adding -1, -2, ... if that name is
 * taken, so nothing is ever clobbered). Returns the new path, or null when there was nothing to keep.
 */
export async function keepExisting(file, now = new Date()) {
  if (!existsSync(file)) return null;
  const ext = extname(file);
  const stem = join(dirname(file), `${basename(file, ext)}.${utcStamp(now)}`);
  let target = `${stem}${ext}`;
  for (let n = 1; existsSync(target); n++) target = `${stem}-${n}${ext}`;
  await rename(file, target);
  return target;
}

/** Write `data` to `file`, first keeping any existing file under a timestamped name. Never overwrites. */
export async function writeKeepingOld(file, data, now = new Date()) {
  const kept = await keepExisting(file, now);
  await writeFile(file, data, { flag: "wx" }); // fails instead of overwriting if something reappeared
  return kept;
}
