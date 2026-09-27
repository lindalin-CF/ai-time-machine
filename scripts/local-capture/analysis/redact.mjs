#!/usr/bin/env node
/**
 * Fill rectangles of a PNG with a solid color (e.g. to hide conversation titles or account details
 * before replacing a public screenshot). Pure JS (pngjs).
 *
 * Boxes are in image pixels (equal to measure.mjs CSS px only at scale 1). Boxes are clamped to the image.
 *
 * USAGE:
 *   node analysis/redact.mjs <in.png> <out.png> <x,y,w,h> [<x,y,w,h> ...] [--color #RRGGBB]
 *   # --color defaults to #2A2A2A
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PNG } from "pngjs";

function parseHex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`--color must be #RRGGBB (got "${h}")`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

function parseBox(v) {
  const m = /^(\d+),(\d+),(\d+),(\d+)$/.exec(v);
  if (!m) throw new Error(`box must be <x>,<y>,<w>,<h> non-negative integers (got "${v}")`);
  const [x, y, w, h] = m.slice(1).map(Number);
  if (!w || !h) throw new Error(`box has zero size: ${v}`);
  return { x, y, w, h };
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
    console.error("usage: redact.mjs <in.png> <out.png> <x,y,w,h> [<x,y,w,h> ...] [--color #RRGGBB]");
    process.exit(1);
  }
  if (resolve(input) === resolve(output)) throw new Error("out.png must differ from in.png");

  const [r, g, b] = parseHex(color);
  const boxes = boxArgs.map(parseBox);
  const png = PNG.sync.read(readFileSync(input));

  for (const { x, y, w, h } of boxes) {
    const x1 = Math.min(png.width, x + w), y1 = Math.min(png.height, y + h);
    if (x >= png.width || y >= png.height) throw new Error(`box ${x},${y},${w},${h} is outside the ${png.width}x${png.height} image`);
    for (let py = y; py < y1; py++) {
      for (let px = x; px < x1; px++) {
        const i = (py * png.width + px) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
    }
    console.log(`✓ filled ${x},${y},${x1 - x},${y1 - y} with ${color.toUpperCase()}`);
  }

  writeFileSync(output, PNG.sync.write(png));
  console.log(`✓ wrote ${output} (${png.width}x${png.height})`);
}

try { main(); } catch (e) { console.error(`✗ ${e.message}`); process.exit(1); }
