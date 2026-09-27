import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { fetchIcons, iconSource, isPng } from '../../scripts/fetch-icons.mjs';

// Tests never create or delete image files: writes go to an injected recorder, and the only real
// file touched is the committed fixture, which must come out unchanged.
const FIXTURES = fileURLToPath(new URL('../fixtures/', import.meta.url));
const FIXTURE = `${FIXTURES}note-image.png`;
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16]);

function recorder() {
  const writes: { path: string; flag?: string }[] = [];
  return { writes, write: async (path: string, _b: Uint8Array, o: { flag?: string }) => { writes.push({ path, flag: o.flag }); } };
}
function fakeFetch(body: Uint8Array, type: string, status = 200) {
  const urls: string[] = [];
  return { urls, impl: async (url: string) => { urls.push(url); return new Response(body, { status, headers: { 'content-type': type } }); } };
}

describe('scripts/fetch-icons.mjs', () => {
  it('never touches an icon that already exists: no download, no write', async () => {
    const before = sha(FIXTURE);
    const f = fakeFetch(PNG, 'image/png');
    const results = await fetchIcons({ portals: [{ slug: 'note-image', url: 'https://example.com/' }], dir: FIXTURES, fetchImpl: f.impl });
    expect(results).toEqual([{ slug: 'note-image', status: 'exists' }]);
    expect(f.urls).toEqual([]);
    expect(sha(FIXTURE)).toBe(before);
  });

  it('writes new icons with the exclusive flag, from the favicon service, host without www.', async () => {
    const r = recorder();
    const f = fakeFetch(PNG, 'image/png');
    const results = await fetchIcons({ portals: [{ slug: 'new-portal', url: 'https://www.example.com/chat' }], dir: '/nonexistent-dir', fetchImpl: f.impl, write: r.write });
    expect(f.urls).toEqual([iconSource('example.com')]);
    expect(r.writes).toEqual([{ path: '/nonexistent-dir/new-portal.png', flag: 'wx' }]);
    expect(results[0].status).toBe('saved');
  });

  it('reports a file that appeared between the check and the write as existing', async () => {
    const eexist = async () => { throw Object.assign(new Error('EEXIST: file already exists'), { code: 'EEXIST' }); };
    const results = await fetchIcons({ portals: [{ slug: 'race', url: 'https://example.com/' }], dir: '/nonexistent-dir', fetchImpl: fakeFetch(PNG, 'image/png').impl, write: eexist });
    expect(results[0].status).toBe('exists');
  });

  it('converts JPEG answers to PNG and rejects anything that is not an image', async () => {
    const r = recorder();
    const converted: string[] = [];
    const convert = async (_b: Uint8Array, type: string) => { converted.push(type); return PNG; };
    const ok = await fetchIcons({ portals: [{ slug: 'jpeg', url: 'https://example.com/' }], dir: '/nonexistent-dir', fetchImpl: fakeFetch(JPEG, 'image/jpeg').impl, write: r.write, convert });
    expect(converted).toEqual(['image/jpeg']);
    expect(ok[0].status).toBe('saved');

    const html = await fetchIcons({ portals: [{ slug: 'html', url: 'https://example.com/' }], dir: '/nonexistent-dir', fetchImpl: fakeFetch(new TextEncoder().encode('<html>'), 'text/html').impl, write: r.write, convert });
    const missing = await fetchIcons({ portals: [{ slug: 'gone', url: 'https://example.com/' }], dir: '/nonexistent-dir', fetchImpl: fakeFetch(PNG, 'image/png', 404).impl, write: r.write, convert });
    const badSlug = await fetchIcons({ portals: [{ slug: '../escape', url: 'https://example.com/' }], dir: '/nonexistent-dir', fetchImpl: fakeFetch(PNG, 'image/png').impl, write: r.write, convert });
    expect([html[0].status, missing[0].status, badSlug[0].status]).toEqual(['failed', 'failed', 'failed']);
    expect(r.writes.map((w) => w.path)).toEqual(['/nonexistent-dir/jpeg.png']);
    expect(isPng(PNG)).toBe(true);
    expect(isPng(JPEG)).toBe(false);
  });
});
