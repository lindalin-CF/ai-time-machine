/**
 * Download each portal's icon once into public/icons/<slug>.png, so visitors' browsers never
 * contact Google's favicon service (public/app.js loads /icons/<slug>.png instead).
 *
 *   node scripts/fetch-icons.mjs                 # portals from the live site + scripts/seed-source/portals.json
 *   node scripts/fetch-icons.mjs --origin http://localhost:8787
 *
 * The images come from the same source visitors' browsers used before (Google's favicon service,
 * 64px), fetched from this machine instead. The service answers some domains with JPEG; those are
 * re-encoded to PNG in headless Chromium (Playwright, already a devDependency), in memory.
 *
 * An existing icon is never overwritten (CLAUDE.md): it is skipped before any download, and the
 * write itself uses the exclusive "wx" flag. To replace an icon, first move the old file into
 * ~/AI-Surface-Archive/ with `mv -n`, then run this again.
 */
import { access, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const ROOT = fileURLToPath(new URL("..", import.meta.url));
export const ICON_DIR = join(ROOT, "public", "icons");
const SEED = join(ROOT, "scripts", "seed-source", "portals.json");
const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/** The portal URL's host without "www.", as public/app.js passed it to the favicon service before. */
export function domainOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, ""); } catch { return ""; }
}

export function iconSource(domain) {
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

export function isPng(bytes) {
  return bytes.length > PNG_SIGNATURE.length && PNG_SIGNATURE.every((b, i) => bytes[i] === b);
}

/** Re-encode any image the browser can decode as PNG bytes. */
export async function toPngInChromium(bytes, contentType) {
  const { chromium } = await import("playwright");
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    const b64 = await page.evaluate(async ({ data, type }) => {
      const blob = new Blob([Uint8Array.from(atob(data), (c) => c.charCodeAt(0))], { type });
      const bitmap = await createImageBitmap(blob);
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      canvas.getContext("2d").drawImage(bitmap, 0, 0);
      const png = new Uint8Array(await (await canvas.convertToBlob({ type: "image/png" })).arrayBuffer());
      let bin = "";
      for (const b of png) bin += String.fromCharCode(b);
      return btoa(bin);
    }, { data: Buffer.from(bytes).toString("base64"), type: contentType });
    return new Uint8Array(Buffer.from(b64, "base64"));
  } finally {
    await browser.close();
  }
}

/** Portals from the live API and the seed file, one per slug (the live entry wins). */
export async function loadPortals({ origin, fetchImpl = fetch } = {}) {
  const bySlug = new Map();
  const seed = JSON.parse(await readFile(SEED, "utf8")).portals;
  for (const p of seed) bySlug.set(p.slug, { slug: p.slug, url: p.url });
  if (origin) {
    const res = await fetchImpl(`${origin}/api/portals`, { headers: { accept: "application/json" } });
    if (!res.ok) throw new Error(`${origin}/api/portals -> ${res.status}`);
    for (const p of (await res.json()).portals) bySlug.set(p.slug, { slug: p.slug, url: p.url });
  }
  return [...bySlug.values()];
}

/**
 * Save a missing icon for each portal. Returns one result per portal:
 * { slug, status: "saved" | "exists" | "failed", detail? }.
 */
export async function fetchIcons({ portals, dir = ICON_DIR, fetchImpl = fetch, write = writeFile, convert = toPngInChromium }) {
  const results = [];
  for (const { slug, url } of portals) {
    if (!/^[a-z0-9-]+$/.test(slug)) { results.push({ slug, status: "failed", detail: "invalid slug" }); continue; }
    const path = join(dir, `${slug}.png`);
    if (await access(path).then(() => true, () => false)) { results.push({ slug, status: "exists" }); continue; }
    const domain = domainOf(url);
    if (!domain) { results.push({ slug, status: "failed", detail: "no domain" }); continue; }
    try {
      const res = await fetchImpl(iconSource(domain));
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      let bytes = new Uint8Array(await res.arrayBuffer());
      const type = (res.headers.get("content-type") ?? "").split(";")[0].trim();
      let note = "";
      if (!isPng(bytes)) {
        if (!/^image\/(jpeg|gif|webp|x-icon|vnd\.microsoft\.icon|bmp)$/.test(type)) throw new Error(`not an image (${type || "no content-type"})`);
        bytes = await convert(bytes, type);
        if (!isPng(bytes)) throw new Error(`could not convert ${type} to PNG`);
        note = `, converted from ${type}`;
      }
      await write(path, bytes, { flag: "wx" }); // fails with EEXIST rather than overwrite
      results.push({ slug, status: "saved", detail: `${bytes.length} bytes from ${domain}${note}` });
    } catch (err) {
      results.push({ slug, status: err?.code === "EEXIST" ? "exists" : "failed", detail: String(err?.message ?? err) });
    }
  }
  return results;
}

async function main() {
  const { values } = parseArgs({ options: { origin: { type: "string", default: "https://ai-portal-library.dev" } } });
  const portals = await loadPortals({ origin: values.origin });
  const results = await fetchIcons({ portals });
  for (const r of results) console.log(`${r.status.padEnd(7)} ${r.slug}${r.detail ? ` (${r.detail})` : ""}`);
  if (results.some((r) => r.status === "failed")) process.exitCode = 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((err) => { console.error(err.message ?? err); process.exit(1); });
}
