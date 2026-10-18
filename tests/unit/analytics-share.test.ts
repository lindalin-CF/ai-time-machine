import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain browser module without type declarations
import { buildAnalyticsHash, decodeLayout, encodeLayout, hashRoute, parseAnalyticsHash } from '../../public/analytics-share.js';

// Shareable Analytics links: everything after #analytics? is read back only through these checks.

const KNOWN = { portals: ['chatgpt', 'claude', 'gemini'], weeks: ['2026-10-12', '2026-10-05', '2026-09-28', '2026-09-21', '2026-09-14'], max: 4 };
const W = KNOWN.weeks;

const canvasSetup = {
  view: 'canvas', mode: 'weeks', portal: 'chatgpt', weeks: [W[0], W[1]], device: 'desktop',
  canvas: {
    ids: [W[0], W[1]],
    pos: { [W[0]]: { x: 120.4, y: 79.6 }, [W[1]]: { x: 540, y: -12.2 } },
    edges: [[W[1], W[0]]],
    cam: { x: 33.7, y: -18.2, k: 1.2799 },
  },
};

describe('encodeLayout / decodeLayout', () => {
  it('round-trips positions (whole pixels) and the direction of each line', () => {
    const s = encodeLayout(canvasSetup.canvas, canvasSetup.canvas.ids);
    expect(s).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(decodeLayout(s)).toEqual({
      pos: { [W[0]]: { x: 120, y: 80 }, [W[1]]: { x: 540, y: -12 } },
      edges: [[W[1], W[0]]],
    });
  });

  it('keeps only cards on the board and lines between them', () => {
    const s = encodeLayout({ pos: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, gone: { x: 5, y: 6 } }, edges: [['a', 'b'], ['a', 'gone']] }, ['a', 'b']);
    expect(decodeLayout(s)).toEqual({ pos: { a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }, edges: [['a', 'b']] });
  });

  it('drops ids that fail the check, and lines to them', () => {
    const s = encodeLayout({ pos: { a: { x: 1, y: 2 }, evil: { x: 3, y: 4 } }, edges: [['a', 'evil']] }, ['a', 'evil']);
    expect(decodeLayout(s, (id: string) => id === 'a')).toEqual({ pos: { a: { x: 1, y: 2 } }, edges: [] });
  });

  it.each([
    ['empty', ''],
    ['not base64url', 'abc$%^'],
    ['not JSON', 'bm90IGpzb24'],
    ['wrong shape', btoa('{"x":1}')],
    ['no usable card', btoa('{"p":[["a","x",1]],"e":[]}')],
    ['too long', 'A'.repeat(5000)],
  ])('returns null for a bad layout (%s)', (_, s) => {
    expect(decodeLayout(s)).toBeNull();
  });

  it('ignores malformed and duplicate lines and clamps huge coordinates', () => {
    const raw = { p: [['a', 1e12, -1e12], ['b', 0, 0]], e: [[0, 1], [1, 0], [0, 0], [0, 9], ['x', 1]] };
    const s = btoa(JSON.stringify(raw)).replace(/=+$/, '');
    expect(decodeLayout(s)).toEqual({ pos: { a: { x: 100000, y: -100000 }, b: { x: 0, y: 0 } }, edges: [['a', 'b']] });
  });
});

describe('buildAnalyticsHash / parseAnalyticsHash', () => {
  it('round-trips an Over time canvas', () => {
    const hash = buildAnalyticsHash(canvasSetup);
    expect(hash.startsWith('#analytics?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-12,2026-10-05&device=desktop&zoom=1.28&pan=34,-18&layout=')).toBe(true);
    expect(parseAnalyticsHash(hash, KNOWN)).toEqual({
      view: 'canvas', mode: 'weeks', portal: 'chatgpt', weeks: [W[0], W[1]], device: 'desktop',
      canvas: {
        zoom: 1.28, pan: [34, -18],
        layout: { pos: { [W[0]]: { x: 120, y: 80 }, [W[1]]: { x: 540, y: -12 } }, edges: [[W[1], W[0]]] },
      },
    });
  });

  it('round-trips an Across portals table without canvas fields', () => {
    const hash = buildAnalyticsHash({ view: 'table', mode: 'portals', week: W[2], portals: ['chatgpt', 'claude'], device: 'mobile', canvas: canvasSetup.canvas });
    expect(hash).toBe('#analytics?view=table&mode=portals&week=2026-09-28&portals=chatgpt,claude&device=mobile');
    expect(parseAnalyticsHash(hash, KNOWN)).toEqual({ view: 'table', mode: 'portals', week: W[2], portals: ['chatgpt', 'claude'], device: 'mobile' });
  });

  it('returns null for old links without parameters, and for other routes', () => {
    expect(parseAnalyticsHash('#analytics', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('#analytics?', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('#notes?view=canvas', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('', KNOWN)).toBeNull();
  });

  it('drops unknown portals and weeks, keeps the site order, and caps at the maximum', () => {
    const s = parseAnalyticsHash('#analytics?mode=time&portal=nope&weeks=2099-01-01,2026-09-14,2026-10-12,2026-10-12,2026-09-21,2026-09-28,2026-10-05', KNOWN);
    expect(s).toEqual({ mode: 'weeks', weeks: ['2026-10-12', '2026-09-28', '2026-09-21', '2026-09-14'] });
    const p = parseAnalyticsHash('#analytics?mode=portals&week=1999-01-01&portals=gemini,<script>,chatgpt', KNOWN);
    expect(p).toEqual({ mode: 'portals', portals: ['chatgpt', 'gemini'] });
  });

  it('leaves out a selection with nothing valid, so defaults apply', () => {
    expect(parseAnalyticsHash('#analytics?mode=time&weeks=x,y&view=grid&device=tv', KNOWN)).toEqual({ mode: 'weeks' });
  });

  it.each([['9', 2], ['0.01', 0.25], ['1.5', 1.5]])('clamps zoom %s to %s', (zoom, k) => {
    expect(parseAnalyticsHash(`#analytics?view=canvas&zoom=${zoom}`, KNOWN).canvas.zoom).toBe(k);
  });

  it('ignores a zoom or pan that is not a number', () => {
    expect(parseAnalyticsHash('#analytics?view=canvas&zoom=abc&pan=1', KNOWN).canvas).toEqual({ zoom: null, pan: null, layout: null });
    expect(parseAnalyticsHash('#analytics?view=canvas&zoom=-1&pan=a,b', KNOWN).canvas).toEqual({ zoom: null, pan: null, layout: null });
  });

  it('falls back to the default layout when the layout cannot be decoded', () => {
    expect(parseAnalyticsHash('#analytics?view=canvas&mode=time&layout=%%%', KNOWN).canvas.layout).toBeNull();
    expect(parseAnalyticsHash('#analytics?view=canvas&mode=time&layout=bm90IGpzb24', KNOWN).canvas.layout).toBeNull();
  });

  it('keeps only layout cards that exist for the mode', () => {
    const layout = encodeLayout({ pos: { chatgpt: { x: 1, y: 1 }, [W[0]]: { x: 2, y: 2 } }, edges: [] }, ['chatgpt', W[0]]);
    expect(parseAnalyticsHash(`#analytics?view=canvas&mode=time&layout=${layout}`, KNOWN).canvas.layout).toEqual({ pos: { [W[0]]: { x: 2, y: 2 } }, edges: [] });
    expect(parseAnalyticsHash(`#analytics?view=canvas&mode=portals&layout=${layout}`, KNOWN).canvas.layout).toEqual({ pos: { chatgpt: { x: 1, y: 1 } }, edges: [] });
  });

  it('hashRoute strips the parameters', () => {
    expect(hashRoute('#analytics?view=canvas')).toBe('#analytics');
    expect(hashRoute('#analytics')).toBe('#analytics');
    expect(hashRoute('')).toBe('');
  });
});
