import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain browser module without type declarations
import { buildAnalyticsHash, compareHash, decodeLayout, encodeLayout, hashRoute, parseAnalyticsHash } from '../../public/analytics-share.js';

// Shareable Compare links: everything after #compare? is read back only through these checks.

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

  const key = (a: string, b: string) => [a, b].sort().join('\u0000');

  it('round-trips moved boxes as whole-pixel offsets, and writes none for boxes at the midpoint', () => {
    const layout = {
      pos: { a: { x: 0, y: 0 }, b: { x: 500, y: 0 }, c: { x: 1000, y: 0 } },
      edges: [['a', 'b'], ['c', 'a']],
      offsets: { [key('a', 'b')]: { dx: 40.6, dy: -120.2 }, [key('a', 'c')]: { dx: 0, dy: 0 } },
    };
    const s = encodeLayout(layout, ['a', 'b', 'c']);
    expect(JSON.parse(atob(s.replace(/-/g, '+').replace(/_/g, '/'))).e).toEqual([[0, 1, 41, -120], [2, 0]]);
    expect(decodeLayout(s)).toEqual({ pos: layout.pos, edges: layout.edges, offsets: { [key('a', 'b')]: { dx: 41, dy: -120 } } });
  });

  it('decodes an old link without offsets as before (no offsets field)', () => {
    const s = btoa(JSON.stringify({ p: [['a', 0, 0], ['b', 500, 0]], e: [[0, 1]] })).replace(/=+$/, '');
    expect(decodeLayout(s)).toEqual({ pos: { a: { x: 0, y: 0 }, b: { x: 500, y: 0 } }, edges: [['a', 'b']] });
  });

  it('ignores malformed offsets and clamps huge ones', () => {
    const raw = { p: [['a', 0, 0], ['b', 0, 0], ['c', 0, 0]], e: [[0, 1, 1e12, -1e12], [0, 2, 'x', 5], [1, 2, 7]] };
    const s = btoa(JSON.stringify(raw)).replace(/=+$/, '');
    expect(decodeLayout(s)).toEqual({
      pos: { a: { x: 0, y: 0 }, b: { x: 0, y: 0 }, c: { x: 0, y: 0 } },
      edges: [['a', 'b'], ['a', 'c'], ['b', 'c']],
      offsets: { [key('a', 'b')]: { dx: 100000, dy: -100000 } },
    });
  });
});

describe('buildAnalyticsHash / parseAnalyticsHash', () => {
  it('round-trips an Over time canvas', () => {
    const hash = buildAnalyticsHash(canvasSetup);
    expect(hash.startsWith('#compare?view=canvas&mode=time&portal=chatgpt&weeks=2026-10-12,2026-10-05&device=desktop&zoom=1.28&pan=34,-18&layout=')).toBe(true);
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
    expect(hash).toBe('#compare?view=table&mode=portals&week=2026-09-28&portals=chatgpt,claude&device=mobile');
    expect(parseAnalyticsHash(hash, KNOWN)).toEqual({ view: 'table', mode: 'portals', week: W[2], portals: ['chatgpt', 'claude'], device: 'mobile' });
  });

  it('returns null for old links without parameters, and for other routes', () => {
    expect(parseAnalyticsHash('#compare', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('#compare?', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('#notes?view=canvas', KNOWN)).toBeNull();
    expect(parseAnalyticsHash('', KNOWN)).toBeNull();
  });

  it('drops unknown portals and weeks, keeps the site order, and caps at the maximum', () => {
    const s = parseAnalyticsHash('#compare?mode=time&portal=nope&weeks=2099-01-01,2026-09-14,2026-10-12,2026-10-12,2026-09-21,2026-09-28,2026-10-05', KNOWN);
    expect(s).toEqual({ mode: 'weeks', weeks: ['2026-10-12', '2026-09-28', '2026-09-21', '2026-09-14'] });
    const p = parseAnalyticsHash('#compare?mode=portals&week=1999-01-01&portals=gemini,<script>,chatgpt', KNOWN);
    expect(p).toEqual({ mode: 'portals', portals: ['chatgpt', 'gemini'] });
  });

  it('leaves out a selection with nothing valid, so defaults apply', () => {
    expect(parseAnalyticsHash('#compare?mode=time&weeks=x,y&view=grid&device=tv', KNOWN)).toEqual({ mode: 'weeks' });
  });

  it.each([['9', 2], ['0.01', 0.25], ['1.5', 1.5]])('clamps zoom %s to %s', (zoom, k) => {
    expect(parseAnalyticsHash(`#compare?view=canvas&zoom=${zoom}`, KNOWN).canvas.zoom).toBe(k);
  });

  it('ignores a zoom or pan that is not a number', () => {
    expect(parseAnalyticsHash('#compare?view=canvas&zoom=abc&pan=1', KNOWN).canvas).toEqual({ zoom: null, pan: null, layout: null });
    expect(parseAnalyticsHash('#compare?view=canvas&zoom=-1&pan=a,b', KNOWN).canvas).toEqual({ zoom: null, pan: null, layout: null });
  });

  it('falls back to the default layout when the layout cannot be decoded', () => {
    expect(parseAnalyticsHash('#compare?view=canvas&mode=time&layout=%%%', KNOWN).canvas.layout).toBeNull();
    expect(parseAnalyticsHash('#compare?view=canvas&mode=time&layout=bm90IGpzb24', KNOWN).canvas.layout).toBeNull();
  });

  it('keeps only layout cards that exist for the mode', () => {
    const layout = encodeLayout({ pos: { chatgpt: { x: 1, y: 1 }, [W[0]]: { x: 2, y: 2 } }, edges: [] }, ['chatgpt', W[0]]);
    expect(parseAnalyticsHash(`#compare?view=canvas&mode=time&layout=${layout}`, KNOWN).canvas.layout).toEqual({ pos: { [W[0]]: { x: 2, y: 2 } }, edges: [] });
    expect(parseAnalyticsHash(`#compare?view=canvas&mode=portals&layout=${layout}`, KNOWN).canvas.layout).toEqual({ pos: { chatgpt: { x: 1, y: 1 } }, edges: [] });
  });

  it('compareHash turns an old #analytics hash into #compare, keeping its setup, and leaves others alone', () => {
    expect(compareHash('#analytics')).toBe('#compare');
    expect(compareHash('#analytics?view=canvas&zoom=1.28')).toBe('#compare?view=canvas&zoom=1.28');
    expect(compareHash('#compare?view=table')).toBe('#compare?view=table');
    expect(compareHash('#analyticsView')).toBe('#analyticsView');
    expect(compareHash('#notes')).toBe('#notes');
    expect(compareHash('')).toBe('');
  });

  it('reads an old #analytics link the same as #compare', () => {
    const hash = buildAnalyticsHash(canvasSetup);
    expect(parseAnalyticsHash(hash.replace('#compare', '#analytics'), KNOWN)).toEqual(parseAnalyticsHash(hash, KNOWN));
    expect(parseAnalyticsHash('#analytics', KNOWN)).toBeNull();
  });

  it('hashRoute strips the parameters', () => {
    expect(hashRoute('#compare?view=canvas')).toBe('#compare');
    expect(hashRoute('#compare')).toBe('#compare');
    expect(hashRoute('')).toBe('');
  });
});
