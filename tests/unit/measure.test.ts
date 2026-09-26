import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { PNG } from 'pngjs';

const MEASURE = resolve(__dirname, '../../scripts/local-capture/analysis/measure.mjs');

function measure(...args: string[]) {
  return JSON.parse(execFileSync('node', [MEASURE, ...args], { encoding: 'utf8' }));
}

// 20x20 white image with a red 4x3 block at (5,6) and one blue pixel at (12,10).
// Not a 1280x800 multiple, so scale is null and CSS px = image px.
let dir: string;
let file: string;

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'measure-test-'));
  file = join(dir, 'fixture.png');
  const png = new PNG({ width: 20, height: 20 });
  const set = (x: number, y: number, [r, g, b]: number[]) => {
    const i = (y * 20 + x) * 4;
    png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
  };
  for (let y = 0; y < 20; y++) for (let x = 0; x < 20; x++) set(x, y, [255, 255, 255]);
  for (let y = 6; y < 9; y++) for (let x = 5; x < 9; x++) set(x, y, [255, 0, 0]);
  set(12, 10, [0, 0, 255]);
  writeFileSync(file, PNG.sync.write(png));
});

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe('measure.mjs extent', () => {
  it('bounds all non-background pixels with a ring-median background', () => {
    const out = measure('extent', file, '0', '0', '20', '20');
    expect(out.background).toBe('#FFFFFF');
    expect(out.threshold).toBe(30);
    expect(out.pixel_count).toBe(13);
    expect(out.bbox_css_px).toEqual([5, 6, 8, 5]);
  });

  it('only scans inside the box', () => {
    const out = measure('extent', file, '2', '2', '9', '9');
    expect(out.pixel_count).toBe(12);
    expect(out.bbox_css_px).toEqual([5, 6, 4, 3]);
  });

  it('returns a null bbox when nothing differs', () => {
    const out = measure('extent', file, '14', '14', '5', '5');
    expect(out.pixel_count).toBe(0);
    expect(out.bbox_css_px).toBeNull();
  });

  it('honours --bg and --threshold', () => {
    // Against a red background, white and blue both differ; red does not.
    const red = measure('extent', file, '0', '0', '20', '20', '--bg', '#FF0000');
    expect(red.background).toBe('#FF0000');
    expect(red.pixel_count).toBe(400 - 12);
    // Red and blue are both 510 away from white; the rule is strictly greater-than.
    const high = measure('extent', file, '0', '0', '20', '20', '--threshold', '510');
    expect(high.pixel_count).toBe(0);
    expect(high.bbox_css_px).toBeNull();
  });
});

describe('measure.mjs colors', () => {
  it('returns hex for several points in one call', () => {
    expect(measure('colors', file, '0,0', '5,6', '12,10')).toEqual([
      { x: 0, y: 0, hex: '#FFFFFF' },
      { x: 5, y: 6, hex: '#FF0000' },
      { x: 12, y: 10, hex: '#0000FF' },
    ]);
  });

  it('rejects malformed points', () => {
    expect(() => execFileSync('node', [MEASURE, 'colors', file, '3'], { stdio: 'pipe' })).toThrow();
  });
});
