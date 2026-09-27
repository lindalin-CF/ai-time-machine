import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
// @ts-expect-error -- plain .mjs script without type declarations
import { utcStamp, keepExisting, writeKeepingOld } from '../../scripts/local-capture/analysis/keep-existing.mjs';

const NOW = new Date('2026-09-27T00:45:12.345Z');

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'keep-existing-test-')); });
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const read = (name: string) => readFileSync(join(dir, name), 'utf8');

describe('utcStamp', () => {
  it('formats as the archive timestamp (seconds, UTC, no separators)', () => {
    expect(utcStamp(NOW)).toBe('20260927T004512Z');
  });
});

describe('keepExisting', () => {
  it('returns null and touches nothing when the file is absent', async () => {
    expect(await keepExisting(join(dir, 'current.png'), NOW)).toBeNull();
    expect(readdirSync(dir)).toEqual([]);
  });

  it('renames an existing file with a UTC timestamp suffix', async () => {
    writeFileSync(join(dir, 'previous.png'), 'old');
    const kept = await keepExisting(join(dir, 'previous.png'), NOW);
    expect(kept).toBe(join(dir, 'previous.20260927T004512Z.png'));
    expect(readdirSync(dir)).toEqual(['previous.20260927T004512Z.png']);
    expect(read('previous.20260927T004512Z.png')).toBe('old');
  });
});

describe('writeKeepingOld', () => {
  it('writes a new file when none exists', async () => {
    expect(await writeKeepingOld(join(dir, 'current.png'), 'new', NOW)).toBeNull();
    expect(read('current.png')).toBe('new');
  });

  it('keeps the existing file under a timestamped name before writing', async () => {
    writeFileSync(join(dir, 'current.png'), 'v1');
    await writeKeepingOld(join(dir, 'current.png'), 'v2', NOW);
    expect(read('current.png')).toBe('v2');
    expect(read('current.20260927T004512Z.png')).toBe('v1');
  });

  it('never clobbers an earlier kept file with the same timestamp', async () => {
    writeFileSync(join(dir, 'current.png'), 'v1');
    await writeKeepingOld(join(dir, 'current.png'), 'v2', NOW);
    await writeKeepingOld(join(dir, 'current.png'), 'v3', NOW);
    await writeKeepingOld(join(dir, 'current.png'), 'v4', NOW);
    expect(readdirSync(dir).sort()).toEqual([
      'current.20260927T004512Z-1.png',
      'current.20260927T004512Z-2.png',
      'current.20260927T004512Z.png',
      'current.png',
    ]);
    expect(read('current.20260927T004512Z.png')).toBe('v1');
    expect(read('current.20260927T004512Z-1.png')).toBe('v2');
    expect(read('current.20260927T004512Z-2.png')).toBe('v3');
    expect(read('current.png')).toBe('v4');
  });
});
