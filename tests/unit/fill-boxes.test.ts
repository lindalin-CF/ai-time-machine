import { describe, it, expect } from 'vitest';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';
// @ts-expect-error -- plain .mjs module, no type declarations
import { fillBoxes } from '../../scripts/local-capture/analysis/fill-boxes.mjs';

// Temp dirs are left in place on purpose: CLAUDE.md forbids deleting image files, even test ones.
const REDACT = new URL('../../scripts/local-capture/analysis/redact.mjs', import.meta.url).pathname;

/** A w x h image where every pixel has a distinct, recognisable colour. */
function pattern(w: number, h: number): PNG {
  const png = new PNG({ width: w, height: h });
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = (y * w + x) * 4;
    png.data[i] = x * 7 % 256; png.data[i + 1] = y * 11 % 256; png.data[i + 2] = (x + y) % 256; png.data[i + 3] = 255;
  }
  return png;
}
const px = (p: PNG, x: number, y: number) => [...p.data.subarray((y * p.width + x) * 4, (y * p.width + x) * 4 + 4)];
const insideEllipse = (x: number, y: number, [bx, by, bw, bh]: number[]) => {
  const dx = (x + 0.5 - (bx + bw / 2)) / (bw / 2), dy = (y + 0.5 - (by + bh / 2)) / (bh / 2);
  return dx * dx + dy * dy <= 1;
};

describe('fillBoxes', () => {
  it('circle fills only pixels inside the ellipse and leaves every other pixel as it was', () => {
    const before = pattern(40, 30), after = pattern(40, 30);
    const box = [10, 5, 16, 12];
    fillBoxes(after, [[...box, '#5f5f5f', 'circle']]);
    let filled = 0;
    for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) {
      if (insideEllipse(x, y, box)) { expect(px(after, x, y)).toEqual([0x5f, 0x5f, 0x5f, 255]); filled++; }
      else expect(px(after, x, y)).toEqual(px(before, x, y));
    }
    // Corners of the box are outside the ellipse and keep their original colour.
    expect(px(after, 10, 5)).toEqual(px(before, 10, 5));
    expect(px(after, 25, 16)).toEqual(px(before, 25, 16));
    expect(filled).toBeGreaterThan(0);
    expect(filled).toBeLessThan(16 * 12);
  });

  it('rectangle fills the whole box and nothing outside it (unchanged behaviour)', () => {
    const before = pattern(20, 20), after = pattern(20, 20);
    fillBoxes(after, [[3, 4, 5, 6, '#c8c8c8']]);
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      const inBox = x >= 3 && x < 8 && y >= 4 && y < 10;
      expect(px(after, x, y)).toEqual(inBox ? [0xc8, 0xc8, 0xc8, 255] : px(before, x, y));
    }
  });

  it('clamps to the image without reshaping the ellipse', () => {
    const before = pattern(20, 20), after = pattern(20, 20);
    const [b] = fillBoxes(after, [[14, 14, 10, 10, '#5f5f5f', 'circle']]);
    expect(b).toEqual({ x: 14, y: 14, w: 6, h: 6, fill: '#5F5F5F', shape: 'circle' });
    for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) {
      if (!insideEllipse(x, y, [14, 14, 10, 10])) expect(px(after, x, y)).toEqual(px(before, x, y));
    }
  });

  it('rejects bad boxes', () => {
    const p = pattern(10, 10);
    expect(() => fillBoxes(p, [[0, 0, 0, 4, '#000000']])).toThrow(/zero size/);
    expect(() => fillBoxes(p, [[0, 0, 4, 4, '#000000', 'star']])).toThrow(/shape/);
    expect(() => fillBoxes(p, [[0, 0, 4, 4, 'grey']])).toThrow(/#RRGGBB/);
    expect(() => fillBoxes(p, [[12, 0, 4, 4, '#000000']])).toThrow(/outside/);
  });
});

describe('redact.mjs', () => {
  const run = (...args: string[]) => spawnSync(process.execPath, [REDACT, ...args], { encoding: 'utf8' });

  it('gives the same pixels as fillBoxes for rect and circle boxes', () => {
    const dir = mkdtempSync(join(tmpdir(), 'redact-'));
    const input = join(dir, 'in.png'), output = join(dir, 'out.png');
    writeFileSync(input, PNG.sync.write(pattern(40, 30)));
    const res = run(input, output, '2,2,6,4', '10,5,16,12,circle', '--color', '#5f5f5f');
    expect(res.status, res.stderr).toBe(0);
    const expected = pattern(40, 30);
    fillBoxes(expected, [[2, 2, 6, 4, '#5f5f5f'], [10, 5, 16, 12, '#5f5f5f', 'circle']]);
    expect(Buffer.compare(PNG.sync.read(readFileSync(output)).data, expected.data)).toBe(0);
  });

  it('never overwrites an existing output file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'redact-'));
    const input = join(dir, 'in.png'), output = join(dir, 'out.png');
    writeFileSync(input, PNG.sync.write(pattern(10, 10)));
    writeFileSync(output, 'keep me');
    const res = run(input, output, '0,0,2,2');
    expect(res.status).not.toBe(0);
    expect(readFileSync(output, 'utf8')).toBe('keep me');
    expect(statSync(input).size).toBeGreaterThan(0);
  });
});
