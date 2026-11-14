import { beforeEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
// @ts-expect-error -- plain .mjs script, no type declarations
import { preview, build, uploadVisual, candidateProblem, ledgerProblem, visualHtml, chipDate, parseBox } from '../../scripts/local-capture/analysis/visual.mjs';
// @ts-expect-error -- plain .mjs script, no type declarations
import { parsePublishArgs } from '../../scripts/local-capture/analysis/publish.mjs';

// The local side of before/after visuals (scripts/local-capture/analysis/visual.mjs, publish.mjs): the approval gate,
// held-capture safety at build time, the redaction-ledger check, and archive-before-replace on upload.
// Temp dirs are left in place on purpose: CLAUDE.md forbids deleting image files, even test ones.

const SLUG = 'claude', OLD = '2026-11-02', NEW = '2026-11-09';
const SENTENCE = 'The Chat and Cowork buttons no longer appear in the message box.';
const sha1 = (b: Buffer) => createHash('sha1').update(b).digest('hex');

/** A PNG header of the given size plus filler bytes (enough for pngSize()). */
function png(w: number, h: number, fill = 0): Buffer {
  const b = Buffer.alloc(64, fill);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0);
  b.writeUInt32BE(13, 8); b.write('IHDR', 12); b.writeUInt32BE(w, 16); b.writeUInt32BE(h, 20);
  return b;
}
const BEFORE = png(1280, 800, 1), AFTER = png(1280, 800, 2), RENDERED = png(704, 394, 3);

let root: string, work: string, dir: string, terms: string, ledgerFile: string;
let renders: unknown[];
const render = async (o: unknown) => { renders.push(o); return RENDERED; };

function analysis(o: Record<string, unknown> = {}) {
  return { status: 'ok', previous_week: OLD, changes_vs_previous: [{ id: 'N1', status: 'changed', change: 'removed', previous: 'Chat' }], ...o };
}
function ledger(rows: Record<string, unknown>[]) { writeFileSync(ledgerFile, JSON.stringify({ version: 1, images: rows })); }
const row = (week: string, bytes: Buffer, o: Record<string, unknown> = {}) =>
  ({ slug: SLUG, week, variant: 'desktop', result: 'redacted', upload_status: 'uploaded', original_sha1: 'x', redacted_sha1: sha1(bytes), ...o });

/** The public site, without the token: `held` weeks are not listed, as in GET /api/captures. */
function site(held: string[] = []) {
  const calls: { url: string; auth: string | null }[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    calls.push({ url, auth: new Headers(init?.headers).get('authorization') });
    const week = /week=([\d-]+)/.exec(url)?.[1];
    if (url.includes('/api/captures')) {
      return Response.json({ captures: held.includes(week!) ? [] : [{ slug: SLUG, status: 'ok', image: `/img/shots/${week}/claude.local.png?v=1` }] });
    }
    const w = /shots\/([\d-]+)\//.exec(url)?.[1];
    if (held.includes(w!)) return new Response('not found', { status: 404 });
    return new Response(new Uint8Array(w === OLD ? BEFORE : AFTER));
  };
  return { fetchFn, calls };
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'visual-'));
  work = join(root, 'work');
  dir = join(work, SLUG, NEW);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'analysis.json'), JSON.stringify(analysis()));
  writeFileSync(join(dir, 'input.json'), JSON.stringify({ plan: 'Pro', previous_plan: 'Pro' }));
  writeFileSync(join(dir, 'previous.png'), BEFORE);
  writeFileSync(join(dir, 'current.png'), AFTER);
  terms = join(root, 'private-terms.txt');
  writeFileSync(terms, 'SecretWorkspace\n');
  ledgerFile = join(root, 'ledger.json');
  ledger([row(OLD, BEFORE), row(NEW, AFTER)]);
  renders = [];
});

const doPreview = (o: Record<string, unknown> = {}) => preview({ slug: SLUG, week: NEW, before: '432,304,704,194', sentence: SENTENCE, work, render, termsFile: terms, ...o });
const doBuild = (o: Record<string, unknown> = {}) => build({ slug: SLUG, week: NEW, approved: true, work, site: 'https://site', fetchFn: site().fetchFn, render, ledgerFile, ...o });

describe('helpers', () => {
  it('formats chip dates and parses crop boxes', () => {
    expect(chipDate('2026-11-02')).toBe('Nov 2');
    expect(chipDate('2026-12-28')).toBe('Dec 28');
    expect(parseBox('432,304,704,194')).toEqual([432, 304, 704, 194]);
    for (const bad of ['1,2,3', '1,2,-3,4', '0,0,10,10', 'a,b,c,d']) expect(() => parseBox(bad)).toThrow();
  });

  it('builds the template: previous on top, site chips, a neutral gap', () => {
    const half = (word: string, date: string) => ({ box: [10, 20, 300, 100], size: { width: 1280, height: 800 }, dataUrl: 'data:x', word, date });
    const html = visualHtml({ before: half('Before', 'Nov 2'), after: half('After', 'Nov 9') });
    expect(html.indexOf('Before</b> · <span class="when">Nov 2')).toBeLessThan(html.indexOf('After</b> · <span class="when">Nov 9'));
    expect(html).toContain("font:600 13px/16px 'Afacad'");
    expect(html).toMatch(/gap:6px;width:300px;background:#f4efe8/);
    expect(html).not.toMatch(/red|#f00|#e5484d/i);
    expect(() => visualHtml({ before: half('Before', 'Nov 2'), after: { ...half('After', 'Nov 9'), box: [0, 0, 200, 100] } })).toThrow(/same width/);
  });
});

describe('which changes may get a visual', () => {
  it('only an ok analysis with a "changed" entry and the same plan', () => {
    expect(candidateProblem(analysis(), { plan: 'Pro', previous_plan: 'Pro' })).toBeNull();
    expect(candidateProblem(null, {})).toMatch(/missing/);
    expect(candidateProblem(analysis({ status: 'not_analyzable' }), {})).toMatch(/status/);
    expect(candidateProblem(analysis({ previous_week: null }), {})).toMatch(/no previous week/);
    expect(candidateProblem(analysis({ changes_vs_previous: [{ id: 'N1', status: 'possibly_confounded' }] }), {})).toMatch(/changed/);
    expect(candidateProblem(analysis({ changes_vs_previous: [] }), {})).toMatch(/changed/);
    expect(candidateProblem(analysis(), { plan: 'Pro', previous_plan: 'Free' })).toMatch(/plan changed/);
  });
});

describe('preview (step 1, /analyze-week)', () => {
  it('writes a local preview and suggestion from the work folder, and never touches the network', async () => {
    const realFetch = globalThis.fetch;
    globalThis.fetch = (() => { throw new Error('preview must not fetch'); }) as typeof fetch;
    try {
      const r = await doPreview();
      expect(r.file).toBe(join(dir, 'visual-preview.png'));
      expect(readFileSync(r.file)).toEqual(RENDERED);
      const s = JSON.parse(readFileSync(join(dir, 'visual-suggestion.json'), 'utf8'));
      expect(s).toMatchObject({ slug: SLUG, week: NEW, previous_week: OLD, alt: SENTENCE, before_box: [432, 304, 704, 194], after_box: [432, 304, 704, 194], labels: ['Before · Nov 2', 'After · Nov 9'] });
      expect(renders[0]).toMatchObject({ previousWeek: OLD, week: NEW, beforePng: BEFORE, afterPng: AFTER });
      expect(existsSync(join(dir, 'visual.png'))).toBe(false);
    } finally {
      globalThis.fetch = realFetch;
    }
  });

  it('keeps an earlier preview under a timestamped name', async () => {
    await doPreview();
    await doPreview();
    expect(readdirSync(dir).filter((f) => /^visual-preview\.\d{8}T\d{6}Z(-\d+)?\.png$/.test(f))).toHaveLength(1);
  });

  it('refuses confounded or plan-changed weeks, private terms and bad sentences', async () => {
    writeFileSync(join(dir, 'input.json'), JSON.stringify({ plan: 'Pro', previous_plan: 'Free' }));
    await expect(doPreview()).rejects.toThrow(/plan changed/);
    writeFileSync(join(dir, 'input.json'), JSON.stringify({ plan: 'Pro', previous_plan: 'Pro' }));
    await expect(doPreview({ sentence: 'The SecretWorkspace item moved.' })).rejects.toThrow(/private term\(s\), private-terms.txt line\(s\) 1$/);
    await expect(doPreview({ sentence: 'short' })).rejects.toThrow(/change sentence/);
    expect(renders).toHaveLength(0);
  });
});

describe('build (step 2): the approval gate', () => {
  beforeEach(async () => { await doPreview(); renders = []; });

  it('refuses without an explicit approval, before reading or fetching anything', async () => {
    const s = site();
    for (const approved of [undefined, false, 'yes', 1]) {
      await expect(doBuild({ approved, fetchFn: s.fetchFn })).rejects.toThrow(/--approved/);
    }
    expect(s.calls).toHaveLength(0);
    expect(renders).toHaveLength(0);
    expect(existsSync(join(dir, 'visual.png'))).toBe(false);
  });

  it('refuses without a suggestion from the preview step', async () => {
    const other = join(work, 'gemini', NEW);
    mkdirSync(other, { recursive: true });
    writeFileSync(join(other, 'analysis.json'), JSON.stringify(analysis()));
    await expect(doBuild({ slug: 'gemini' })).rejects.toThrow(/visual-suggestion\.json/);
  });

  it('crops the public, redacted screenshots, fetched without the token', async () => {
    const s = site();
    const r = await doBuild({ fetchFn: s.fetchFn });
    expect(s.calls.every((c) => c.auth === null)).toBe(true);
    expect(renders[0]).toMatchObject({ beforePng: BEFORE, afterPng: AFTER, beforeBox: [432, 304, 704, 194], previousWeek: OLD, week: NEW });
    expect(readFileSync(join(dir, 'visual.png'))).toEqual(RENDERED);
    expect(r.meta).toMatchObject({ slug: SLUG, week: NEW, previous_week: OLD, alt: SENTENCE, sha1: sha1(RENDERED), width: 704, height: 394 });
  });

  it('refuses while either week is held (not public)', async () => {
    for (const week of [OLD, NEW]) {
      await expect(doBuild({ fetchFn: site([week]).fetchFn })).rejects.toThrow(new RegExp(`${week} has no public desktop capture`));
    }
    expect(renders).toHaveLength(0);
    expect(existsSync(join(dir, 'visual.png'))).toBe(false);
  });

  it('refuses a screenshot that is not the redacted image in the ledger', async () => {
    ledger([row(OLD, BEFORE), row(NEW, png(1280, 800, 9))]);
    await expect(doBuild()).rejects.toThrow(/not the redacted image in the ledger/);
    ledger([row(OLD, BEFORE)]);
    await expect(doBuild()).rejects.toThrow(/no redaction ledger row/);
    // "release anyway": uploaded but never redacted.
    ledger([row(OLD, BEFORE), row(NEW, AFTER, { upload_status: 'pending review' })]);
    await expect(doBuild()).rejects.toThrow(/not the redacted image/);
    expect(renders).toHaveLength(0);
  });

  it('accepts an original reviewed as "no change"', () => {
    const l = { images: [row(NEW, AFTER, { result: 'no change', upload_status: 'no change', redacted_sha1: null, original_sha1: sha1(AFTER) })] };
    expect(ledgerProblem(l, SLUG, NEW, AFTER)).toBeNull();
  });
});

describe('publish.mjs flags (step 3)', () => {
  it('uploads a visual only with --visual or --visual-only', () => {
    expect(parsePublishArgs([SLUG, NEW])).toEqual({ slug: SLUG, week: NEW, analysis: true, visual: false });
    expect(parsePublishArgs([SLUG, NEW, '--visual'])).toEqual({ slug: SLUG, week: NEW, analysis: true, visual: true });
    expect(parsePublishArgs([SLUG, NEW, '--visual-only'])).toEqual({ slug: SLUG, week: NEW, analysis: false, visual: true });
    expect(parsePublishArgs([SLUG, NEW, '--visual', '--visual-only']).error).toMatch(/not both/);
    expect(parsePublishArgs([SLUG, NEW, '--approve-visual']).error).toMatch(/unknown option/);
    expect(parsePublishArgs([SLUG]).error).toMatch(/usage/);
  });

  it('publish.mjs calls the visual upload only behind the flag', () => {
    const src = readFileSync(new URL('../../scripts/local-capture/analysis/publish.mjs', import.meta.url), 'utf8');
    expect(src.match(/await publishVisual\(slug, week\)/g)).toHaveLength(2);
    expect(src).toContain('if (!args.analysis) return await publishVisual(slug, week);');
    expect(src).toContain('if (args.visual) await publishVisual(slug, week);');
  });
});

describe('uploadVisual', () => {
  let archive: string;
  beforeEach(async () => {
    await doPreview();
    await doBuild();
    archive = join(root, 'archive');
  });

  function cloud(live: Buffer | null, o: { failGet?: boolean } = {}) {
    const steps: string[] = [];
    const exec = (_cmd: string, args: string[]) => {
      steps.push(`r2 ${args[4]} ${args[3]}`);
      if (o.failGet) return { status: 1, stdout: Buffer.alloc(0), stderr: 'Authentication error' };
      return live ? { status: 0, stdout: live, stderr: '' } : { status: 1, stdout: Buffer.alloc(0), stderr: 'The specified key does not exist.' };
    };
    const posts: { url: string; body: Record<string, string>; auth: string | null }[] = [];
    const fetchFn = async (url: string, init: RequestInit) => {
      steps.push('POST');
      posts.push({ url, body: JSON.parse(String(init.body)), auth: new Headers(init.headers).get('authorization') });
      return Response.json({ ok: true });
    };
    return { exec, fetchFn, steps, posts };
  }
  const up = (c: ReturnType<typeof cloud>, o: Record<string, unknown> = {}) =>
    uploadVisual({ slug: SLUG, week: NEW, token: 'tok', work, site: 'https://site', fetchFn: c.fetchFn, exec: c.exec, archiveDir: archive, termsFile: terms, now: new Date('2026-11-14T01:00:00Z'), ...o });

  it('posts visual.png with the change sentence when nothing is live yet', async () => {
    const c = cloud(null);
    const r = await up(c);
    expect(r.archived).toBeNull();
    expect(c.posts).toHaveLength(1);
    expect(c.posts[0]).toMatchObject({ url: 'https://site/api/visual', auth: 'Bearer tok' });
    expect(c.posts[0].body).toMatchObject({ slug: SLUG, week: NEW, previous_week: OLD, alt: SENTENCE, imageBase64: RENDERED.toString('base64') });
  });

  it('archives a different live visual byte for byte before posting', async () => {
    const old = png(704, 394, 5);
    const c = cloud(old);
    const r = await up(c);
    expect(r.archived).toBe(join(archive, `visuals/${NEW}/${SLUG}.png.20261114T010000Z.png`));
    expect(readFileSync(r.archived)).toEqual(old);
    expect(c.steps.indexOf('POST')).toBeGreaterThan(c.steps.lastIndexOf(`r2 ai-portal-shots/visuals/${NEW}/${SLUG}.png get`));
    // A second replacement never overwrites the first archive.
    const again = await up(cloud(png(704, 394, 6)));
    expect(again.archived).toBe(join(archive, `visuals/${NEW}/${SLUG}.png.20261114T010000Z-2.png`));
    expect(readFileSync(r.archived)).toEqual(old);
  });

  it('posts nothing when the live object cannot be read', async () => {
    const c = cloud(null, { failGet: true });
    await expect(up(c)).rejects.toThrow(/could not read the live/);
    expect(c.posts).toHaveLength(0);
  });

  it('refuses a missing or mismatched build, a missing token and private terms', async () => {
    const c = cloud(null);
    await expect(up(c, { token: '' })).rejects.toThrow(/UPLOAD_TOKEN/);
    writeFileSync(join(dir, 'visual.png'), png(704, 394, 8), { flag: 'w' });
    await expect(up(c)).rejects.toThrow(/does not match visual\.json/);
    const meta = JSON.parse(readFileSync(join(dir, 'visual.json'), 'utf8'));
    writeFileSync(join(dir, 'visual.json'), JSON.stringify({ ...meta, sha1: sha1(png(704, 394, 8)), alt: 'The SecretWorkspace item moved.' }));
    await expect(up(c)).rejects.toThrow(/private term/);
    await expect(up(c, { slug: 'gemini' })).rejects.toThrow(/no visual\.json/);
    expect(c.posts).toHaveLength(0);
  });
});
