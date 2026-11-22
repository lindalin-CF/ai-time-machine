import { describe, expect, it } from 'vitest';
import { handleApi } from '../../src/api';
import { makeEnv } from './fake-env';

// POST /api/capture/run and /api/capture/portal start Browser Rendering and write R2 and D1, so they need the upload
// token like every other write (src/api.ts requireUploadToken). Without it nothing is queued or started.

function setup() {
  const t = makeEnv(); // has Claude, UPLOAD_TOKEN 'test-token'
  const queued: unknown[] = [], started: unknown[] = [];
  Object.assign(t.env, {
    CAPTURE_QUEUE: { async sendBatch(msgs: unknown[]) { queued.push(...msgs); } },
    CAPTURE_WORKFLOW: { async create(o: unknown) { started.push(o); return { id: 'wf-1' }; } },
  });
  return { env: t.env, queued, started };
}
const ctx = { waitUntil() {}, passThroughOnException() {} } as unknown as ExecutionContext;
const post = (env: ReturnType<typeof setup>['env'], path: string, token?: string) => handleApi(new Request(`https://x${path}`, {
  method: 'POST', body: JSON.stringify({ slug: 'claude', week: '2026-11-23' }),
  headers: { 'content-type': 'application/json', ...(token ? { authorization: `Bearer ${token}` } : {}) },
}), env, ctx);

describe('capture endpoints need the upload token', () => {
  it.each(['/api/capture/portal', '/api/capture/run'])('%s refuses without the token or with a wrong one', async (path) => {
    const s = setup();
    expect((await post(s.env, path)).status).toBe(401);
    expect((await post(s.env, path, 'wrong')).status).toBe(401);
    expect(s.queued).toEqual([]);
    expect(s.started).toEqual([]);
  });

  it('refuses when the Worker has no token configured', async () => {
    const s = setup();
    delete (s.env as unknown as Record<string, unknown>).UPLOAD_TOKEN;
    expect((await post(s.env, '/api/capture/run', 'anything')).status).toBe(500);
    expect(s.started).toEqual([]);
  });

  it('runs with the token', async () => {
    const s = setup();
    const portal = await post(s.env, '/api/capture/portal', 'test-token');
    expect(portal.status).toBe(200);
    expect(s.queued).toEqual([{ body: { week: '2026-11-23', slug: 'claude' } }]);
    const run = await post(s.env, '/api/capture/run', 'test-token');
    expect(run.status).toBe(200);
    expect(s.started).toHaveLength(1);
  });
});
