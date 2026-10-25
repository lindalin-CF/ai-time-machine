import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const DIR = new URL('../../scripts/local-capture/analysis/golden/', import.meta.url).pathname;
const files = readdirSync(DIR).filter((f) => f.endsWith('.json'));
const items = files.map((f) => ({ f, d: JSON.parse(readFileSync(join(DIR, f), 'utf8')) }));

describe('golden set', () => {
  it('has 15 analyses covering the required portals and confounded weeks', () => {
    expect(items).toHaveLength(15);
    const slugs = new Set(items.map((x) => x.d.slug));
    for (const s of ['chatgpt', 'claude', 'gemini', 'grok', 'meta-ai']) expect(slugs).toContain(s);
    const confounded = items.filter((x) => x.d.changes_vs_previous.some((c: { status: string }) => c.status !== 'changed'));
    expect(confounded.length).toBeGreaterThanOrEqual(2);
  });

  it('points only at redacted screenshots, never originals', () => {
    for (const { d } of items) {
      for (const shot of [d.screenshot, d.previous_screenshot]) {
        if (!shot?.redacted) continue;
        expect(shot.redacted).toMatch(/\/redacted[^/]*\.png$/);
        expect(shot.redacted).not.toMatch(/original|current\.png|previous\.png/);
      }
      expect(d.screenshot.redacted).toBeTruthy();
    }
  });

  it('gives every sentence a label and note field with an allowed value', () => {
    for (const { f, d } of items) {
      expect(d.id, f).toBe(f.replace(/\.json$/, ''));
      expect(d.sentences.length).toBeGreaterThanOrEqual(5);
      for (const s of d.sentences) {
        expect(['', 'correct', 'wrong', 'unsure']).toContain(s.label);
        expect(typeof s.note).toBe('string');
        expect(typeof s.text).toBe('string');
      }
    }
  });

  it('review page loads nothing from the network', () => {
    const html = readFileSync(join(DIR, 'review.html'), 'utf8');
    expect(html).toMatch(/connect-src 'none'/);
    expect(html).not.toMatch(/(?:src|href)=["']https?:/);
    expect(html).not.toMatch(/fetch\(|XMLHttpRequest|sendBeacon|WebSocket/);
  });
});
