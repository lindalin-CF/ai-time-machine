import type { Env } from "./types";
import { CACHE_VERSION } from "./db";

export type ImageSize = { width: number; height: number };

/** Bytes read from the start of an R2 object to find its size. Enough for PNG, GIF, WebP and nearly every JPEG. */
export const IMAGE_SIZE_HEAD = 64 * 1024;

const u16be = (b: Uint8Array, i: number) => (b[i] << 8) | b[i + 1];
const u32be = (b: Uint8Array, i: number) => ((b[i] << 24) >>> 0) + (b[i + 1] << 16) + (b[i + 2] << 8) + b[i + 3];
const u16le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8);
const u24le = (b: Uint8Array, i: number) => b[i] | (b[i + 1] << 8) | (b[i + 2] << 16);
const ascii = (b: Uint8Array, i: number, n: number) => String.fromCharCode(...b.subarray(i, i + n));

/** EXIF orientation (1–8) from a JPEG APP1 segment's TIFF data, or 1. */
function exifOrientation(t: Uint8Array): number {
  if (t.length < 8) return 1;
  const le = t[0] === 0x49 && t[1] === 0x49; // "II"
  const r16 = (i: number) => (le ? u16le(t, i) : u16be(t, i));
  const r32 = (i: number) => (le ? (t[i] | (t[i + 1] << 8) | (t[i + 2] << 16) | (t[i + 3] << 24)) >>> 0 : u32be(t, i));
  const ifd = r32(4);
  if (ifd + 2 > t.length) return 1;
  const n = r16(ifd);
  for (let k = 0; k < n; k++) {
    const e = ifd + 2 + 12 * k;
    if (e + 12 > t.length) break;
    if (r16(e) === 0x0112) return r16(e + 8) || 1;
  }
  return 1;
}

/**
 * Displayed pixel size of a PNG, GIF, WebP or JPEG from its first bytes, or null if the format is
 * unknown or the header isn't in `b`. JPEGs report their EXIF-rotated size, the way browsers show them.
 */
export function parseImageSize(b: Uint8Array): ImageSize | null {
  // PNG: IHDR is always the first chunk.
  if (b.length >= 24 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG" && ascii(b, 12, 4) === "IHDR") {
    return { width: u32be(b, 16), height: u32be(b, 20) };
  }
  // GIF87a / GIF89a: logical screen size.
  if (b.length >= 10 && ascii(b, 0, 3) === "GIF") return { width: u16le(b, 6), height: u16le(b, 8) };
  // WebP: RIFF....WEBP then a VP8, VP8L or VP8X chunk.
  if (b.length >= 30 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    const chunk = ascii(b, 12, 4);
    if (chunk === "VP8X") return { width: u24le(b, 24) + 1, height: u24le(b, 27) + 1 };
    if (chunk === "VP8L") {
      const bits = b[21] | (b[22] << 8) | (b[23] << 16) | (b[24] << 24);
      return { width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1 };
    }
    if (chunk === "VP8 ") return { width: u16le(b, 26) & 0x3fff, height: u16le(b, 28) & 0x3fff };
    return null;
  }
  // JPEG: walk the segments to the first SOF marker, noting EXIF orientation on the way.
  if (b.length >= 4 && b[0] === 0xff && b[1] === 0xd8) {
    let i = 2;
    let orientation = 1;
    while (i + 4 <= b.length) {
      if (b[i] !== 0xff) { i++; continue; }
      const m = b[i + 1];
      if (m === 0xff) { i++; continue; } // fill byte
      if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7)) { i += 2; continue; } // no length
      const len = u16be(b, i + 2);
      if (m === 0xe1 && ascii(b, i + 4, 6) === "Exif\0\0") orientation = exifOrientation(b.subarray(i + 10, i + 2 + len));
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        if (i + 9 > b.length) return null;
        const height = u16be(b, i + 5), width = u16be(b, i + 7);
        return orientation >= 5 && orientation <= 8 ? { width: height, height: width } : { width, height };
      }
      if (m === 0xd9 || m === 0xda) return null; // end of image / start of scan before any SOF
      i += 2 + len;
    }
    return null;
  }
  return null;
}

/**
 * Size of an image in the SHOTS bucket. `version` is the ?v= of its public URL, so a replaced object
 * is measured again. Results are kept in KV with no expiry: a key and version always have one size.
 */
export async function imageSizeOf(env: Env, key: string | null | undefined, version: string | number): Promise<ImageSize | null> {
  if (!key) return null;
  const cacheKey = `${CACHE_VERSION}:imgsize:${key}@${version}`;
  try {
    const hit = await env.CACHE.get<ImageSize>(cacheKey, "json");
    if (hit && hit.width > 0 && hit.height > 0) return hit;
  } catch { /* measure below */ }
  try {
    const head = await env.SHOTS.get(key, { range: { offset: 0, length: IMAGE_SIZE_HEAD } });
    if (!head) return null;
    let size = parseImageSize(new Uint8Array(await head.arrayBuffer()));
    if (!size) {
      const full = await env.SHOTS.get(key); // a JPEG with a large header before its size
      if (full) size = parseImageSize(new Uint8Array(await full.arrayBuffer()));
    }
    if (size && size.width > 0 && size.height > 0) {
      await env.CACHE.put(cacheKey, JSON.stringify(size));
      return size;
    }
  } catch (err) {
    console.error(`imageSizeOf ${key} failed:`, err);
  }
  return null;
}

/** Sizes of the seeded sample screenshots (public/samples/<slug>.svg); tests check this against the files. */
export const SAMPLE_SIZES: Readonly<Record<string, ImageSize>> = {
  chatgpt: { width: 1280, height: 860 },
  claude: { width: 1280, height: 860 },
  gemini: { width: 1280, height: 860 },
};
export const DEFAULT_SAMPLE_SIZE: ImageSize = { width: 1280, height: 800 };
export const sampleSize = (slug: string): ImageSize => SAMPLE_SIZES[slug] ?? DEFAULT_SAMPLE_SIZE;

/**
 * Size a mobile screenshot has when it can't be measured: the local capture's phone viewport
 * (scripts/local-capture/capture.mjs MOBILE_VIEWPORT, 390x844 at 2x). Tests check the two agree.
 */
export const MOBILE_CAPTURE_SIZE: ImageSize = { width: 780, height: 1688 };
