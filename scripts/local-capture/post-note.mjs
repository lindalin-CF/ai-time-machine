/**
 * Post a note to the Notes section of the site (POST /api/insights/upload).
 *
 *   export UPLOAD_TOKEN=...            # must match the Worker secret (`wrangler secret put UPLOAD_TOKEN`)
 *   node post-note.mjs --title "Claude shipped a new project picker" \
 *     --description "One or two sentences." --image ./shot-1.png --image ./shot-2.png
 *
 * WORKER_URL (optional) overrides the site from config.mjs.
 *
 * Images are only read, never modified, moved or deleted. Each post uploads them to new R2 keys
 * (insights/<new id>-<n>.<ext>), so nothing already in R2 is replaced.
 * The token is sent only in the Authorization header and never printed.
 */
import { readFile, stat } from "node:fs/promises";
import { basename, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { WORKER_URL, UPLOAD_TOKEN } from "./config.mjs";

// The API silently cuts longer values (that is how the "production agents ar" note lost its ending),
// so reject them here instead.
export const MAX_TITLE = 120;
export const MAX_DESCRIPTION = 260;
export const MAX_IMAGES = 5;
const MIN_IMAGE_BYTES = 100;
const MAX_IMAGE_BYTES = 12 * 1024 * 1024;
const IMAGE_TYPES = { ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };

/** Parse and validate command-line arguments. Throws an Error with a readable message. */
export function parseNoteArgs(argv) {
  const { values } = parseArgs({
    args: argv,
    options: {
      title: { type: "string" },
      description: { type: "string" },
      image: { type: "string", multiple: true },
    },
    strict: true,
    allowPositionals: false,
  });
  const title = (values.title ?? "").trim();
  const description = (values.description ?? "").trim();
  const images = values.image ?? [];
  if (!title) throw new Error("--title is required");
  if (title.length > MAX_TITLE) throw new Error(`--title is ${title.length} characters; the limit is ${MAX_TITLE}`);
  if (description.length > MAX_DESCRIPTION) {
    throw new Error(`--description is ${description.length} characters; the limit is ${MAX_DESCRIPTION}`);
  }
  if (images.length > MAX_IMAGES) throw new Error(`at most ${MAX_IMAGES} --image files (got ${images.length})`);
  for (const p of images) {
    if (!IMAGE_TYPES[extname(p).toLowerCase()]) throw new Error(`${p}: only .png, .jpg, .jpeg and .webp images are supported`);
  }
  return { title, description, images };
}

/** Read every image (read-only) and check its size before anything is uploaded. */
export async function readImages(paths) {
  const out = [];
  for (const p of paths) {
    const info = await stat(p).catch(() => null);
    if (!info?.isFile()) throw new Error(`${p}: file not found`);
    if (info.size < MIN_IMAGE_BYTES) throw new Error(`${p}: file is too small to be an image`);
    if (info.size > MAX_IMAGE_BYTES) throw new Error(`${p}: file is larger than 12MB`);
    out.push({ name: basename(p), type: IMAGE_TYPES[extname(p).toLowerCase()], bytes: await readFile(p) });
  }
  return out;
}

/** Send the note. Returns the API's JSON on success; throws an Error that never contains the token. */
export async function postNote({ workerUrl, token, title, description, images, fetchImpl = fetch }) {
  if (!token) throw new Error("Set UPLOAD_TOKEN first:  export UPLOAD_TOKEN=<the value you gave `wrangler secret put UPLOAD_TOKEN`>");
  const form = new FormData();
  form.set("title", title);
  form.set("description", description);
  for (const img of images) form.append("image", new Blob([img.bytes], { type: img.type }), img.name);

  const redact = (s) => String(s).split(token).join("[redacted]");
  let res;
  try {
    res = await fetchImpl(`${workerUrl}/api/insights/upload`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: form,
    });
  } catch (err) {
    throw new Error(`request failed: ${redact(err?.message ?? err)}`);
  }
  const out = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`post failed (${res.status}): ${redact(out.error ?? "no error message")}`);
  return out;
}

async function main() {
  const args = parseNoteArgs(process.argv.slice(2));
  const images = await readImages(args.images);
  const out = await postNote({ workerUrl: WORKER_URL, token: UPLOAD_TOKEN, ...args, images });
  console.log(`✓ Posted "${out.title}" (${out.id}) with ${out.images?.length ?? 0} image(s)`);
  console.log(`  ${WORKER_URL}/#notes`);
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main().catch((e) => { console.error(`✗ ${e.message}`); process.exit(1); });
}
