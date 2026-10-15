import { describe, expect, it } from 'vitest';
import { canonicalRedirect, noindexOnWorkersDev } from '../../src/host';

const WORKERS_DEV = 'https://ai-portal-library.monthtest970509.workers.dev';
const html = () => new Response('<!doctype html>', { headers: { 'content-type': 'text/html; charset=utf-8' } });

describe('www redirect', () => {
  it('sends www to the bare domain with a 301', () => {
    const res = canonicalRedirect(new URL('https://www.ai-portal-library.dev/'))!;
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ai-portal-library.dev/');
  });

  it('keeps the path and the query', () => {
    const res = canonicalRedirect(new URL('https://www.ai-portal-library.dev/portals/claude?x=1&y=a%20b'))!;
    expect(res.status).toBe(301);
    expect(res.headers.get('location')).toBe('https://ai-portal-library.dev/portals/claude?x=1&y=a%20b');
  });

  it('redirects http www to https too', () => {
    expect(canonicalRedirect(new URL('http://www.ai-portal-library.dev/portals/muse'))!.headers.get('location'))
      .toBe('https://ai-portal-library.dev/portals/muse');
  });

  it('never redirects workers.dev, so uploads keep working', () => {
    expect(canonicalRedirect(new URL(`${WORKERS_DEV}/api/upload`))).toBeNull();
    expect(canonicalRedirect(new URL(`${WORKERS_DEV}/portals/claude`))).toBeNull();
  });

  it('does not redirect the bare domain', () => {
    expect(canonicalRedirect(new URL('https://ai-portal-library.dev/'))).toBeNull();
    expect(canonicalRedirect(new URL('https://ai-portal-library.dev/portals/claude?x=1'))).toBeNull();
  });
});

describe('noindex on workers.dev', () => {
  it('marks HTML pages', () => {
    for (const path of ['/', '/portals/claude', '/changes', '/license']) {
      expect(noindexOnWorkersDev(new URL(WORKERS_DEV + path), html()).headers.get('x-robots-tag')).toBe('noindex');
    }
  });

  it('leaves the API, screenshots and uploads alone', () => {
    for (const path of ['/api/portals', '/api/upload', '/img/shots/2026-10-05/claude.local.png']) {
      expect(noindexOnWorkersDev(new URL(WORKERS_DEV + path), html()).headers.get('x-robots-tag')).toBeNull();
    }
  });

  it('leaves non-HTML responses alone', () => {
    const xml = new Response('<urlset/>', { headers: { 'content-type': 'application/xml' } });
    expect(noindexOnWorkersDev(new URL(`${WORKERS_DEV}/sitemap.xml`), xml).headers.get('x-robots-tag')).toBeNull();
  });

  it('does not mark the bare domain', () => {
    expect(noindexOnWorkersDev(new URL('https://ai-portal-library.dev/'), html()).headers.get('x-robots-tag')).toBeNull();
  });

  it('keeps the status and other headers', () => {
    const res = new Response('nope', { status: 404, headers: { 'content-type': 'text/html', 'cache-control': 'public, max-age=60' } });
    const marked = noindexOnWorkersDev(new URL(`${WORKERS_DEV}/portals/nope`), res);
    expect(marked.status).toBe(404);
    expect(marked.headers.get('cache-control')).toBe('public, max-age=60');
  });
});
