#!/usr/bin/env node
/**
 * Fill rectangles or circles of a PNG with a solid color (e.g. to hide conversation titles, account
 * details or avatars before replacing a public screenshot). Pure JS (pngjs); the fill itself is
 * analysis/fill-boxes.mjs, the same code the redact-week command uses.
 *
 * Boxes are in image pixels (equal to measure.mjs CSS px only at scale 1). Boxes are clamped to the image.
 * Add ",circle" to a box to fill only the ellipse inside it (pixels outside stay as they were).
 *
 * USAGE:
 *   node analysis/redact.mjs <in.png> <out.png> <x,y,w,h[,circle]> [...] [--color #RRGGBB]
 *   # --color defaults to #2A2A2A
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";
import { fillBoxes, parseHex } from "./fill-boxes.mjs";

function parseBox(v, color) {
  const m = /^(\d+),(\d+),(\d+),(\d+)(?:,(rect|circle))?$/.exec(v);
  if (!m) throw new Error(`box must be <x>,<y>,<w>,<h>[,circle] non-negative integers (got "${v}")`);
  return [...m.slice(1, 5).map(Number), color, m[5] ?? "rect"];
}

function main() {
  const args = process.argv.slice(2);
  let color = "#2A2A2A";
  const pos = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--color") {
      if (i + 1 >= args.length) throw new Error("--color needs a value");
      color = args[++i];
    } else pos.push(args[i]);
  }
  const [input, output, ...boxArgs] = pos;
  if (!input || !output || !boxArgs.length) {
    console.error("usage: redact.mjs <in.png> <out.png> <x,y,w,h[,circle]> [...] [--color #RRGGBB]");
    process.exit(1);
  }
  if (resolve(input) === resolve(output)) throw new Error("out.png must differ from in.png");
  parseHex(color);

  const png = PNG.sync.read(readFileSync(input));
  for (const b of fillBoxes(png, boxArgs.map((v) => parseBox(v, color)))) {
    console.log(`✓ filled ${b.shape} ${b.x},${b.y},${b.w},${b.h} with ${b.fill}`);
  }

  // Never overwrite an existing file (CLAUDE.md screenshot safety).
  writeFileSync(output, PNG.sync.write(png), { flag: "wx" });
  console.log(`✓ wrote ${output} (${png.width}x${png.height})`);
}

try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
