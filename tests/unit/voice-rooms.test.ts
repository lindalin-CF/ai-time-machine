import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import { isVoiceRoomPath, VOICE_RETENTION_MS } from '../../src/voice-room';

// Each browser tab talks to its own voice room. In production one room is one PortalVoiceAgent
// Durable Object (routeAgentRequest maps /agents/portal-voice-agent/<room> to idFromName(room)),
// and each Durable Object has its own message table. The browser test below drives the real
// public/voice.js and vendored VoiceClient against a stand-in server that keeps one message log
// per room, the same way, and answers with that room's history.

const PUBLIC = new URL('../../public/', import.meta.url);
const INDEX_HTML = readFileSync(new URL('index.html', PUBLIC), 'utf8').replace('<html lang="en"', '<html data-consent="not-required" lang="en"');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe('voice room names (Worker)', () => {
  it('accepts only random per-tab rooms', () => {
    expect(isVoiceRoomPath('/agents/portal-voice-agent/0b6f3c2e-8f1a-4c3d-9e2b-7a5d4c3b2a19')).toBe(true);
    for (const bad of [
      '/agents/portal-voice-agent/default', // the old shared room
      '/agents/portal-voice-agent/',
      '/agents/portal-voice-agent/0B6F3C2E-8F1A-4C3D-9E2B-7A5D4C3B2A19',
      '/agents/portal-voice-agent/0b6f3c2e-8f1a-4c3d-9e2b-7a5d4c3b2a19/extra',
      '/agents/other-agent/0b6f3c2e-8f1a-4c3d-9e2b-7a5d4c3b2a19',
    ]) expect(isVoiceRoomPath(bad), bad).toBe(false);
  });

  it('refuses every other room before it reaches a Durable Object', () => {
    const index = readFileSync(new URL('../../src/index.ts', import.meta.url), 'utf8');
    const gate = index.indexOf('if (!isVoiceRoomPath(url.pathname)) return new Response("not found", { status: 404 });');
    expect(gate).toBeGreaterThan(-1);
    expect(gate).toBeLessThan(index.indexOf('await routeAgentRequest(request, env)'));
  });

  it('keeps messages for 24 hours after the last one, including the old shared room', () => {
    expect(VOICE_RETENTION_MS).toBe(24 * 60 * 60 * 1000);
    const voice = readFileSync(new URL('../../src/voice.ts', import.meta.url), 'utf8');
    expect(voice).toMatch(/async onTurn\([^)]*\) \{\n\s+await this\.scheduleExpiry\(\);/);
    expect(voice).toContain('this.sql`DELETE FROM cf_voice_messages`;');
    expect(voice).toContain('const stub = await getAgentByName(env.PortalVoiceAgent, "default");');
  });
});

describe('voice rooms in the browser', () => {
  let browser: Browser;
  const rooms = new Map<string, string[]>(); // the stand-in server's storage: one log per room
  const sockets: string[] = [];
  beforeAll(async () => { browser = await chromium.launch(); });
  afterAll(async () => { await browser?.close(); });

  async function visitor(): Promise<BrowserContext> {
    const context = await browser.newContext();
    await context.route('**/*', async (route) => {
      const url = new URL(route.request().url());
      if (url.host !== 'site.test') return route.abort();
      if (url.pathname === '/') return route.fulfill({ contentType: 'text/html', body: INDEX_HTML });
      if (url.pathname === '/app.js' || url.pathname.startsWith('/api/')) return route.fulfill({ status: 404, body: '' });
      try { return route.fulfill({ contentType: url.pathname.endsWith('.css') ? 'text/css' : 'text/javascript', body: readFileSync(new URL(`.${url.pathname}`, PUBLIC)) }); } catch { return route.fulfill({ status: 404, body: '' }); }
    });
    await context.routeWebSocket(/\/agents\//, (ws) => {
      const path = new URL(ws.url()).pathname;
      sockets.push(path);
      if (!isVoiceRoomPath(path)) { ws.close(); return; } // same rule as the Worker
      const room = path.split('/').pop()!;
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type !== 'text_message') return;
        const log = rooms.get(room) ?? [];
        log.push(msg.text);
        rooms.set(room, log);
        ws.send(JSON.stringify({ type: 'transcript', role: 'user', text: msg.text }));
        ws.send(JSON.stringify({ type: 'transcript', role: 'assistant', text: `History: ${log.join(' / ')}` }));
      });
    });
    return context;
  }

  async function ask(page: Page, text: string): Promise<void> {
    if (!(await page.locator('.voice-panel.open').count())) await page.getByRole('button', { name: 'Talk to the library' }).click();
    await page.locator('#vpText').fill(text);
    await page.locator('#vpText').press('Enter');
    await expect.poll(() => page.locator('.vp-msg.assistant').last().innerText().catch(() => '')).toContain(text);
  }
  const room = (page: Page) => page.evaluate(() => sessionStorage.getItem('voice-room'));
  const panel = (page: Page) => page.locator('#vpBody').innerText();

  it('gives two visitors different rooms, and neither sees the other’s messages', async () => {
    const a = await (await visitor()).newPage();
    const b = await (await visitor()).newPage();
    await a.goto('https://site.test/');
    await b.goto('https://site.test/');

    await ask(a, 'Visitor A asks about Claude');
    await ask(b, 'Visitor B asks about Gemini');
    await ask(a, 'Visitor A follows up');

    const [roomA, roomB] = [await room(a), await room(b)];
    expect(roomA).toMatch(UUID);
    expect(roomB).toMatch(UUID);
    expect(roomA).not.toBe(roomB);
    expect(sockets).toContain(`/agents/portal-voice-agent/${roomA}`);
    expect(sockets).toContain(`/agents/portal-voice-agent/${roomB}`);
    expect(sockets.every(isVoiceRoomPath)).toBe(true);

    // Stored history and model context stay per room.
    expect(rooms.get(roomA!)).toEqual(['Visitor A asks about Claude', 'Visitor A follows up']);
    expect(rooms.get(roomB!)).toEqual(['Visitor B asks about Gemini']);
    // What each visitor sees on screen.
    expect(await panel(a)).not.toContain('Visitor B');
    expect(await panel(b)).not.toContain('Visitor A');
    await expect(a.locator('.vp-msg.assistant').last().innerText()).resolves.toBe('History: Visitor A asks about Claude / Visitor A follows up');

    await a.context().close();
    await b.context().close();
  });

  it('keeps a tab’s room across reloads, and gives another tab of the same browser its own room', async () => {
    const context = await visitor();
    const tab1 = await context.newPage();
    await tab1.goto('https://site.test/');
    await ask(tab1, 'First tab question');
    const room1 = await room(tab1);
    await tab1.reload();
    expect(await room(tab1)).toBe(room1);

    const tab2 = await context.newPage();
    await tab2.goto('https://site.test/');
    await ask(tab2, 'Second tab question');
    const room2 = await room(tab2);
    expect(room2).toMatch(UUID);
    expect(room2).not.toBe(room1);
    expect(rooms.get(room2!)).toEqual(['Second tab question']);
    expect(await panel(tab2)).not.toContain('First tab question');
    await context.close();
  });
});
