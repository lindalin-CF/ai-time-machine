import { beforeEach, describe, expect, it } from 'vitest';
import { handleApi, handleImage } from '../../src/api';
import { ARCHIVE_PREFIX, putKeepingOld, storeCapture } from '../../src/capture';
import { getPortal } from '../../src/db';
import { makeEnv } from './fake-env';

// POST /api/upload never loses the screenshot it replaces (CLAUDE.md "Screenshot safety"): the old object is copied to
// archive/<key>.<UTC timestamp>.png and checked before the new one is written. /img/ never serves archive/ keys.

const ORIGIN = 'https://ai-portal-library.dev';
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const WEEK = '2026-10-26';
const KEY = `shots/${WEEK}/claude.local.png`;
const MOBILE = `shots/${WEEK}/claude.mobile.local.png`;
const bytes = (fill: number) => new Uint8Array(200).fill(fill);

let t: ReturnType<typeof makeEnv>;
beforeEach(() => { t = makeEnv(); });

const upload = (fill: number, variant = 'desktop') => handleApi(new Request(`${ORIGIN}/api/upload`, {
  method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer test-token' },
  body: JSON.stringify({ slug: 'claude', week: WEEK, variant, imageBase64: Buffer.from(bytes(fill)).toString('base64') }),
}), t.env, ctx);
const archived = () => [...t.r2.keys()].filter((k) => k.startsWith(ARCHIVE_PREFIX)).sort();

describe('POST /api/upload archives the screenshot it replaces', () => {
  it('copies the old desktop and mobile images byte for byte before writing the new ones', async () => {
    expect((await upload(1)).status).toBe(200);
    expect((await upload(1, 'mobile')).status).toBe(200);
    expect(archived()).toEqual([]); // nothing replaced yet
    expect((await upload(2)).status).toBe(200);
    expect((await upload(2, 'mobile')).status).toBe(200);
    const keys = archived();
    expect(keys).toHaveLength(2);
    const desktop = keys.find((k) => k.startsWith(`archive/${KEY}.`))!;
    const mobile = keys.find((k) => k.startsWith(`archive/${MOBILE}.`))!;
    expect(desktop).toMatch(/^archive\/shots\/2026-10-26\/claude\.local\.png\.\d{8}T\d{6}Z\.png$/);
    expect([...t.r2.get(desktop)!]).toEqual([...bytes(1)]);
    expect([...t.r2.get(mobile)!]).toEqual([...bytes(1)]);
    expect([...t.r2.get(KEY)!]).toEqual([...bytes(2)]);
    expect([...t.r2.get(MOBILE)!]).toEqual([...bytes(2)]);
  });

  it('never overwrites an archive copy: a second replacement in the same second gets -2', async () => {
    const now = new Date('2026-10-31T03:00:00Z');
    t.r2.set(KEY, bytes(1));
    expect(await putKeepingOld(t.env, KEY, bytes(2), now)).toBe(`archive/${KEY}.20261031T030000Z.png`);
    expect(await putKeepingOld(t.env, KEY, bytes(3), now)).toBe(`archive/${KEY}.20261031T030000Z-2.png`);
    expect([...t.r2.get(`archive/${KEY}.20261031T030000Z.png`)!]).toEqual([...bytes(1)]);
    expect([...t.r2.get(`archive/${KEY}.20261031T030000Z-2.png`)!]).toEqual([...bytes(2)]);
  });

  it('does not archive when the same bytes are uploaded again', async () => {
    t.r2.set(KEY, bytes(1));
    expect(await putKeepingOld(t.env, KEY, bytes(1))).toBeNull();
    expect(archived()).toEqual([]);
  });

  it('leaves the old screenshot in place when the archive copy fails its check', async () => {
    t.r2.set(KEY, bytes(1));
    const shots = t.env.SHOTS as unknown as { put: (k: string, v: Uint8Array | ArrayBuffer) => Promise<void> };
    const realPut = shots.put.bind(shots);
    shots.put = async (k, v) => realPut(k, k.startsWith(ARCHIVE_PREFIX) ? new Uint8Array(5) : v); // a corrupted copy
    await expect(putKeepingOld(t.env, KEY, bytes(2))).rejects.toThrow(/failed verification; shots\/2026-10-26\/claude\.local\.png was not replaced/);
    expect([...t.r2.get(KEY)!]).toEqual([...bytes(1)]);
  });

  it('cloud captures replacing their own key are archived too', async () => {
    const portal = (await getPortal(t.env, 'claude'))!;
    await storeCapture(t.env, WEEK, portal, bytes(1), 'cloud');
    await storeCapture(t.env, WEEK, portal, bytes(2), 'cloud');
    expect(archived()).toEqual([expect.stringMatching(/^archive\/shots\/2026-10-26\/claude\.png\.\d{8}T\d{6}Z\.png$/)]);
  });
});

describe('GET /img/ never serves archive/ keys', () => {
  it('answers 404 for an archived copy, with or without the token, and serves the live screenshot', async () => {
    await upload(1);
    await upload(2);
    const [key] = archived();
    for (const headers of [{}, { authorization: 'Bearer test-token' }]) {
      for (const path of [key, encodeURIComponent(key)]) {
        const res = await handleImage(new Request(`${ORIGIN}/img/${path}`, { headers }), t.env);
        expect(res.status, path).toBe(404);
      }
    }
    // The upload is held, so the live screenshot needs the token.
    expect((await handleImage(new Request(`${ORIGIN}/img/${KEY}`, { headers: { authorization: 'Bearer test-token' } }), t.env)).status).toBe(200);
  });
});
