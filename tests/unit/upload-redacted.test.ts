import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs script, no type declarations
import { uploadWeek, selectRows, writeNew, sha1, readProjectConfig } from '../../scripts/local-capture/analysis/upload-redacted.mjs';

// Temp dirs are left in place on purpose: CLAUDE.md forbids deleting image files, even test ones.
const WEEK = '2026-08-24';
const KEY = `shots/${WEEK}/pi.local.png`;
const ORIGINAL = Buffer.from('original-bytes');
const REDACTED = Buffer.from('redacted-bytes');

/** Fake wrangler/curl with in-memory R2, D1 and KV. */
function fakeCloud(live: Record<string, Buffer>) {
  const calls: string[] = [];
  const kvDeleted: string[] = [];
  let capturedAt = '2026-08-28T19:43:15.570Z';
  let putBeforeArchive = false;
  const ok = (stdout: Buffer | string = '') => ({ status: 0, stdout: Buffer.from(stdout), stderr: '' });
  const exec = (cmd: string, args: string[]) => {
    const line = [cmd, ...args].join(' ');
    calls.push(line);
    if (cmd === 'curl') return ok(live[args[1].split('/img/')[1].split('?')[0]]);
    const [, tool, sub, op] = args;
    if (tool === 'r2' && op === 'get') return ok(live[args[4].replace('ai-portal-shots/', '')]);
    if (tool === 'r2' && op === 'put') {
      if (!calls.some((c) => c.includes('r2 object get'))) putBeforeArchive = true;
      live[args[4].replace('ai-portal-shots/', '')] = readFileSync(args[args.indexOf('--file') + 1]);
      return ok();
    }
    if (tool === 'd1') {
      const sql = args[args.indexOf('--command') + 1];
      if (sql.startsWith('SELECT')) return ok(JSON.stringify([{ results: [{ captured_at: capturedAt }] }]));
      const m = /SET captured_at='([^']+)'.*captured_at='([^']+)'/.exec(sql)!;
      const hit = m[2] === capturedAt;
      if (hit) capturedAt = m[1];
      return ok(JSON.stringify([{ meta: { changes: hit ? 1 : 0 } }]));
    }
    if (tool === 'kv' && sub === 'key') { kvDeleted.push(args.at(-1)!); return ok(); }
    return { status: 1, stdout: Buffer.alloc(0), stderr: `unexpected: ${line}` };
  };
  return { exec, calls, kvDeleted, get capturedAt() { return capturedAt; }, get putBeforeArchive() { return putBeforeArchive; } };
}

let root: string, archive: string, redactedFile: string;

function writeLedger(extra: Record<string, unknown> = {}) {
  const row = {
    r2_key: KEY, week: WEEK, slug: 'pi', variant: 'desktop',
    original_sha1: sha1(ORIGINAL), redacted_sha1: sha1(REDACTED), previous_redacted_sha1: [],
    redacted_file: redactedFile, boxes: [], result: 'redacted', date: '2026-09-28',
    upload_status: 'pending review', uploaded_at: null, archived_before_upload: [], ...extra,
  };
  writeFileSync(join(archive, 'redaction-ledger.json'), JSON.stringify({ version: 1, images: [row] }));
}
const ledgerRow = () => JSON.parse(readFileSync(join(archive, 'redaction-ledger.json'), 'utf8')).images[0];
const run = (cloud: ReturnType<typeof fakeCloud>, opts = {}) => uploadWeek(WEEK, {
  root, archiveDir: archive, site: 'https://site.test', exec: cloud.exec, log: () => {},
  now: () => new Date('2026-09-28T03:18:40.123Z'), config: { cacheVersion: 'v2-test', kvId: 'abc123', cacheKeys: ['captures:{week}', 'weeks', 'stats', 'sitemap', 'feed'] }, ...opts,
});

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'upload-redacted-root-'));
  archive = mkdtempSync(join(tmpdir(), 'upload-redacted-archive-'));
  redactedFile = join(root, 'redacted.png');
  writeFileSync(redactedFile, REDACTED);
});

describe('upload-redacted.mjs', () => {
  it('archives the live object first, uploads, verifies, updates ledger, D1 and KV', () => {
    writeLedger();
    const cloud = fakeCloud({ [KEY]: ORIGINAL });
    const [res] = run(cloud);

    expect(res.ok).toBe(true);
    const archived = join(archive, `${KEY}.20260928T031840Z.png`);
    expect(readFileSync(archived).equals(ORIGINAL)).toBe(true);
    expect(cloud.putBeforeArchive).toBe(false);
    expect(cloud.capturedAt).toBe('2026-08-28T19:43:15.571Z');
    expect(cloud.kvDeleted).toEqual([`v2-test:cache:captures:${WEEK}`, 'v2-test:cache:weeks', 'v2-test:cache:stats', 'v2-test:cache:sitemap', 'v2-test:cache:feed']);
    expect(cloud.calls.some((c) => c.startsWith('curl -sf https://site.test/img/') && c.includes('?cb='))).toBe(true);
    const row = ledgerRow();
    expect(row.upload_status).toBe('uploaded');
    expect(row.archived_before_upload).toHaveLength(1);
    // The ledger was snapshotted under a new name before it was rewritten.
    expect(readdirSync(archive).some((f) => /^redaction-ledger\.json\.20260928T031840Z\.\d+\.json$/.test(f))).toBe(true);
    // Nothing destructive was ever run.
    expect(cloud.calls.some((c) => / delete /.test(c) && c.includes(' r2 '))).toBe(false);
  });

  it('refuses to upload when the live object is not the expected one, but still archives it', () => {
    writeLedger();
    const someoneElse = Buffer.from('someone-else');
    const cloud = fakeCloud({ [KEY]: someoneElse });
    const [res] = run(cloud);

    expect(res.ok).toBe(false);
    expect(res.reason).toMatch(/someone changed it/);
    expect(cloud.calls.some((c) => c.includes('r2 object put'))).toBe(false);
    expect(readFileSync(join(archive, `${KEY}.20260928T031840Z.png`)).equals(someoneElse)).toBe(true);
    expect(ledgerRow().upload_status).toMatch(/^failed: /);
  });

  it('uses expected_live_sha1 when replacing an earlier redaction', () => {
    const v1 = Buffer.from('redacted-v1');
    writeLedger({ expected_live_sha1: sha1(v1) });
    const cloud = fakeCloud({ [KEY]: v1 });
    const [res] = run(cloud);

    expect(res.ok).toBe(true);
    expect(readFileSync(join(archive, `${KEY}.20260928T031840Z.png`)).equals(v1)).toBe(true);
  });

  it('never overwrites an existing archive file', () => {
    writeLedger();
    const taken = join(archive, `${KEY}.20260928T031840Z.png`);
    mkdirSync(join(archive, 'shots', WEEK), { recursive: true });
    writeFileSync(taken, 'earlier archive');
    const cloud = fakeCloud({ [KEY]: ORIGINAL });
    run(cloud);

    expect(readFileSync(taken, 'utf8')).toBe('earlier archive');
    expect(readFileSync(join(archive, `${KEY}.20260928T031840Z-2.png`)).equals(ORIGINAL)).toBe(true);
  });

  it('refuses when the local redacted file changed since review', () => {
    writeLedger({ redacted_sha1: sha1(Buffer.from('something else')) });
    const cloud = fakeCloud({ [KEY]: ORIGINAL });
    const [res] = run(cloud);

    expect(res.ok).toBe(false);
    expect(cloud.calls).toHaveLength(0);
  });

  it('dry run touches nothing', () => {
    writeLedger();
    const cloud = fakeCloud({ [KEY]: ORIGINAL });
    const [res] = run(cloud, { dryRun: true });
    expect(res.ok).toBe(true);
    expect(cloud.calls).toHaveLength(0);
    expect(existsSync(join(archive, 'shots'))).toBe(false);
  });
});

describe('readProjectConfig', () => {
  it('reads the cache keys invalidate() in src/capture.ts deletes', () => {
    expect(readProjectConfig().cacheKeys).toEqual(['captures:{week}', 'weeks', 'stats', 'sitemap', 'feed']);
  });
});

describe('selectRows', () => {
  const L = { images: [
    { week: WEEK, slug: 'pi', variant: 'desktop', upload_status: 'pending review' },
    { week: WEEK, slug: 'pi', variant: 'mobile', upload_status: 'pending review' },
    { week: WEEK, slug: 'claude', variant: 'desktop', upload_status: 'pending review' },
    { week: WEEK, slug: 'gemini', variant: 'desktop', upload_status: 'no change' },
    { week: '2026-09-07', slug: 'qwen', variant: 'desktop', upload_status: 'pending review' },
  ] };
  const labels = (rows: { slug: string; variant: string }[]) => rows.map((r) => `${r.slug}/${r.variant}`);

  it('takes pending rows for the week only', () => {
    expect(labels(selectRows(L, WEEK))).toEqual(['pi/desktop', 'pi/mobile', 'claude/desktop']);
  });
  it('excludes a variant or a whole slug', () => {
    expect(labels(selectRows(L, WEEK, { except: ['pi/mobile'] }))).toEqual(['pi/desktop', 'claude/desktop']);
    expect(labels(selectRows(L, WEEK, { except: ['pi'] }))).toEqual(['claude/desktop']);
  });
  it('supports --only', () => {
    expect(labels(selectRows(L, WEEK, { only: ['pi/desktop'] }))).toEqual(['pi/desktop']);
  });
});

describe('writeNew', () => {
  it('adds a suffix instead of overwriting', () => {
    const dir = mkdtempSync(join(tmpdir(), 'upload-redacted-wn-'));
    const p = join(dir, 'a.png');
    expect(writeNew(p, Buffer.from('1'))).toBe(p);
    expect(writeNew(p, Buffer.from('2'))).toBe(join(dir, 'a-2.png'));
    expect(readFileSync(p, 'utf8')).toBe('1');
  });
});
