#!/usr/bin/env node
/**
 * E1 measurements for the portal design-analysis guideline (.claude/skills/portal-design-analysis/SKILL.md).
 * Replaces the guideline's Python (PIL / numpy / scipy) step in this repo. Pure JS (pngjs), JSON output.
 *
 * All coordinates are CSS pixels. The image scale is width / 1280 (section 5), and inputs are
 * multiplied by it before sampling; reported locations are divided by it again.
 *
 * USAGE:
 *   node analysis/measure.mjs size <png>
 *   node analysis/measure.mjs color <png> <x> <y>
 *   node analysis/measure.mjs contrast <png> <x> <y> <w> <h>    # section 7.5
 *   node analysis/measure.mjs pair <hexA> <hexB>
 *   node analysis/measure.mjs diff <current.png> <previous.png>  # section 9.2
 */
import { readFileSync } from "node:fs";
import { PNG } from "pngjs";

const BASE_WIDTH = 1280;

function load(file) {
  const png = PNG.sync.read(readFileSync(file));
  return { width: png.width, height: png.height, data: png.data, scale: scaleOf(png.width, png.height) };
}

/** Integer multiple of 1280x800 -> that multiple; otherwise null (size metrics become not_measured). */
function scaleOf(width, height) {
  const s = width / BASE_WIDTH;
  return Number.isInteger(s) && s >= 1 && height * 16 === width * 10 ? s : null;
}

function rgbAt(img, x, y) {
  const i = (y * img.width + x) * 4;
  return [img.data[i], img.data[i + 1], img.data[i + 2]];
}

const hex = (rgb) => "#" + rgb.map((v) => v.toString(16).padStart(2, "0")).join("").toUpperCase();

function parseHex(h) {
  const m = /^#?([0-9a-f]{6}|[0-9a-f]{3})$/i.exec(h);
  if (!m) throw new Error(`bad hex color: ${h}`);
  const v = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}

/** Section 7.5 step 3: WCAG relative luminance with the 0.04045 threshold. */
function luminance([r, g, b]) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** Section 7.5 step 4: ratio truncated (not rounded) to one decimal. */
function ratio(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  const raw = (hi + 0.05) / (lo + 0.05);
  return { raw, ratio: Math.floor(raw * 10 + 1e-9) / 10 };
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : Math.round((s[mid - 1] + s[mid]) / 2);
}

const medianRgb = (pixels) => [0, 1, 2].map((c) => median(pixels.map((p) => p[c])));

/** CSS-px rect -> clamped image-px rect. */
function toImageRect(img, x, y, w, h) {
  const s = img.scale ?? 1;
  const x0 = Math.max(0, Math.round(x * s)), y0 = Math.max(0, Math.round(y * s));
  const x1 = Math.min(img.width, Math.round((x + w) * s)), y1 = Math.min(img.height, Math.round((y + h) * s));
  if (x1 <= x0 || y1 <= y0) throw new Error("rectangle is empty or outside the image");
  return { x0, y0, x1, y1 };
}

const round10 = (v) => Math.round(v / 10) * 10;

function cmdSize(file) {
  const img = load(file);
  return { width: img.width, height: img.height, scale: img.scale, expected: "1280x800 (or an integer multiple)" };
}

function cmdColor(file, x, y) {
  const img = load(file);
  const { x0, y0 } = toImageRect(img, x, y, 1, 1);
  return { x, y, hex: hex(rgbAt(img, x0, y0)) };
}

/** Section 7.5: background = median of a 4px outer ring; text = median of the top 5% luminance-difference pixels. */
function cmdContrast(file, x, y, w, h) {
  const img = load(file);
  const s = img.scale ?? 1;
  const r = toImageRect(img, x, y, w, h);
  const ring = 4 * s;

  const outer = [];
  for (let py = Math.max(0, r.y0 - ring); py < Math.min(img.height, r.y1 + ring); py++) {
    for (let px = Math.max(0, r.x0 - ring); px < Math.min(img.width, r.x1 + ring); px++) {
      const inside = px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1;
      if (!inside) outer.push(rgbAt(img, px, py));
    }
  }
  if (!outer.length) throw new Error("no background ring pixels (bbox covers the whole image)");
  const background = medianRgb(outer);
  const bgL = luminance(background);

  const inner = [];
  for (let py = r.y0; py < r.y1; py++) {
    for (let px = r.x0; px < r.x1; px++) {
      const p = rgbAt(img, px, py);
      inner.push({ p, d: Math.abs(luminance(p) - bgL) });
    }
  }
  inner.sort((a, b) => b.d - a.d);
  const top = inner.slice(0, Math.max(1, Math.ceil(inner.length * 0.05))).map((e) => e.p);
  const foreground = medianRgb(top);

  const c = ratio(foreground, background);
  return {
    bbox: [x, y, w, h],
    value: `${c.ratio.toFixed(1)}:1`,
    ratio: c.ratio,
    samples: { foreground: hex(foreground), background: hex(background) },
  };
}

function cmdPair(a, b) {
  const c = ratio(parseHex(a), parseHex(b));
  return { a: hex(parseHex(a)), b: hex(parseHex(b)), value: `${c.ratio.toFixed(1)}:1`, ratio: c.ratio };
}

/** Sliding-window max along one axis (dilation by radius r) on a 0/1 mask. */
function dilate1d(src, width, height, r, horizontal) {
  const out = new Uint8Array(src.length);
  const [outerN, innerN] = horizontal ? [height, width] : [width, height];
  const idx = horizontal ? (o, i) => o * width + i : (o, i) => i * width + o;
  for (let o = 0; o < outerN; o++) {
    // Prefix count of set pixels along the line.
    const pre = new Int32Array(innerN + 1);
    for (let i = 0; i < innerN; i++) pre[i + 1] = pre[i] + src[idx(o, i)];
    for (let i = 0; i < innerN; i++) {
      const lo = Math.max(0, i - r), hi = Math.min(innerN, i + r + 1);
      if (pre[hi] - pre[lo] > 0) out[idx(o, i)] = 1;
    }
  }
  return out;
}

/** Section 9.2: changed pixel = RGB difference sum > 30; 12px dilation; connected regions -> bboxes. */
function cmdDiff(curFile, prevFile) {
  const a = load(curFile), b = load(prevFile);
  if (a.width !== b.width || a.height !== b.height) {
    return { skipped: `size mismatch (${a.width}x${a.height} vs ${b.width}x${b.height})`, regions: [] };
  }
  const { width, height } = a;
  const s = a.scale ?? 1;
  const changed = new Uint8Array(width * height);
  let changedCount = 0;
  for (let i = 0; i < width * height; i++) {
    const j = i * 4;
    const d = Math.abs(a.data[j] - b.data[j]) + Math.abs(a.data[j + 1] - b.data[j + 1]) + Math.abs(a.data[j + 2] - b.data[j + 2]);
    if (d > 30) { changed[i] = 1; changedCount++; }
  }

  // 12px (CSS) square dilation, done as two separable passes.
  const r = 12 * s;
  const dilated = dilate1d(dilate1d(changed, width, height, r, true), width, height, r, false);

  // 8-connected components on the dilated mask; bbox = extent of the original changed pixels in each.
  const label = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  const regions = [];
  let next = 0;
  for (let start = 0; start < width * height; start++) {
    if (!dilated[start] || label[start]) continue;
    next++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    label[start] = next;
    let minX = Infinity, minY = Infinity, maxX = -1, maxY = -1, count = 0;
    while (head < tail) {
      const p = queue[head++];
      const px = p % width, py = (p / width) | 0;
      if (changed[p]) {
        count++;
        if (px < minX) minX = px; if (px > maxX) maxX = px;
        if (py < minY) minY = py; if (py > maxY) maxY = py;
      }
      for (let dy = -1; dy <= 1; dy++) {
        const ny = py + dy;
        if (ny < 0 || ny >= height) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const nx = px + dx;
          if (nx < 0 || nx >= width || (dx === 0 && dy === 0)) continue;
          const q = ny * width + nx;
          if (dilated[q] && !label[q]) { label[q] = next; queue[tail++] = q; }
        }
      }
    }
    if (count) {
      const x = minX / s, y = minY / s, w = (maxX - minX + 1) / s, h = (maxY - minY + 1) / s;
      regions.push({
        location: [round10(x), round10(y), Math.max(10, round10(w)), Math.max(10, round10(h))],
        bbox_css_px: [x, y, w, h],
        changed_pixels: count,
      });
    }
  }
  regions.sort((p, q) => q.changed_pixels - p.changed_pixels);
  return { width, height, scale: a.scale, changed_pixels: changedCount, region_count: regions.length, regions };
}

function main() {
  const [cmd, ...args] = process.argv.slice(2);
  const num = (v, name) => {
    const n = Number(v);
    if (!Number.isFinite(n)) throw new Error(`${name} must be a number (got "${v}")`);
    return n;
  };
  let out;
  switch (cmd) {
    case "size": out = cmdSize(args[0]); break;
    case "color": out = cmdColor(args[0], num(args[1], "x"), num(args[2], "y")); break;
    case "contrast": out = cmdContrast(args[0], num(args[1], "x"), num(args[2], "y"), num(args[3], "w"), num(args[4], "h")); break;
    case "pair": out = cmdPair(args[0], args[1]); break;
    case "diff": out = cmdDiff(args[0], args[1]); break;
    default:
      console.error("usage: measure.mjs size|color|contrast|pair|diff ... (see header comment)");
      process.exit(1);
  }
  console.log(JSON.stringify(out, null, 2));
}

try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
