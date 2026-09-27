import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { parseNoteArgs, readImages, postNote, MAX_DESCRIPTION } from '../../scripts/local-capture/post-note.mjs';

const html = readFileSync(new URL('../../public/index.html', import.meta.url), 'utf8');
const appJs = readFileSync(new URL('../../public/app.js', import.meta.url), 'utf8');
// A small committed fixture, only ever read (tests never create or delete image files).
const IMAGE = fileURLToPath(new URL('../fixtures/note-image.png', import.meta.url));
const sha = (p: string) => createHash('sha256').update(readFileSync(p)).digest('hex');
const TOKEN = 'secret-token-123';

function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; init: RequestInit }[] = [];
  const impl = async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(JSON.stringify(body), { status });
  };
  return { calls, impl };
}

describe('the public page has no posting form', () => {
  it('has no form, token field, file input or Post button in the notes section', () => {
    const section = html.match(/<section id="insightsView"[\s\S]*?<\/section>/)![0];
    expect(section).not.toMatch(/<form|<input|type="password"|Upload token|Attach images|Post update/);
    expect(appJs).not.toContain('/api/insights/upload');
  });
});

describe('post-note.mjs arguments', () => {
  it('parses title, description and repeated --image', () => {
    expect(parseNoteArgs(['--title', ' T ', '--description', 'D', '--image', 'a.png', '--image', 'b.JPG'])).toEqual({
      title: 'T', description: 'D', images: ['a.png', 'b.JPG'],
    });
  });

  it('requires a title', () => {
    expect(() => parseNoteArgs(['--description', 'D'])).toThrow('--title is required');
  });

  it('rejects more than 5 images', () => {
    const args = ['--title', 'T', ...Array.from({ length: 6 }, (_, i) => ['--image', `${i}.png`]).flat()];
    expect(() => parseNoteArgs(args)).toThrow('at most 5');
  });

  it('rejects a description the API would cut off instead of posting it truncated', () => {
    expect(() => parseNoteArgs(['--title', 'T', '--description', 'x'.repeat(MAX_DESCRIPTION + 1)])).toThrow('limit is 260');
    expect(parseNoteArgs(['--title', 'T', '--description', 'x'.repeat(MAX_DESCRIPTION)]).description).toHaveLength(260);
  });

  it('rejects unknown flags, including a --token flag', () => {
    expect(() => parseNoteArgs(['--title', 'T', '--token', 'x'])).toThrow();
  });

  it('rejects non-image extensions', () => {
    expect(() => parseNoteArgs(['--title', 'T', '--image', 'notes.txt'])).toThrow('only .png');
  });
});

describe('post-note.mjs images', () => {
  it('reads an image without changing it', async () => {
    const before = sha(IMAGE);
    const [img] = await readImages([IMAGE]);
    expect(img).toMatchObject({ name: 'note-image.png', type: 'image/png' });
    expect(img.bytes.length).toBeGreaterThan(100);
    expect(sha(IMAGE)).toBe(before);
  });

  it('fails before uploading when a file is missing', async () => {
    await expect(readImages(['/nonexistent/shot.png'])).rejects.toThrow('file not found');
  });
});

describe('post-note.mjs request', () => {
  it('sends the token only in the Authorization header, with the form fields and images', async () => {
    const f = fakeFetch(200, { ok: true, id: 'insight-1', title: 'T', images: ['/img/x'] });
    const images = await readImages([IMAGE]);
    await postNote({ workerUrl: 'https://example.test', token: TOKEN, title: 'T', description: 'D', images, fetchImpl: f.impl });
    expect(f.calls).toHaveLength(1);
    const { url, init } = f.calls[0];
    expect(url).toBe('https://example.test/api/insights/upload');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).authorization).toBe(`Bearer ${TOKEN}`);
    const form = init.body as FormData;
    expect(form.get('title')).toBe('T');
    expect(form.get('description')).toBe('D');
    expect(form.getAll('image')).toHaveLength(1);
    expect([...form.values()].some((v) => v === TOKEN)).toBe(false);
  });

  it('refuses to post without a token', async () => {
    await expect(postNote({ workerUrl: 'https://example.test', token: undefined, title: 'T', description: '', images: [] }))
      .rejects.toThrow('Set UPLOAD_TOKEN');
  });

  it('never includes the token in error messages', async () => {
    const f = fakeFetch(401, { error: `unauthorized: ${TOKEN}` });
    const err = await postNote({ workerUrl: 'https://example.test', token: TOKEN, title: 'T', description: '', images: [], fetchImpl: f.impl })
      .catch((e: Error) => e);
    expect(String(err)).toContain('401');
    expect(String(err)).not.toContain(TOKEN);

    const failing = async () => { throw new Error(`connect failed Bearer ${TOKEN}`); };
    const err2 = await postNote({ workerUrl: 'https://example.test', token: TOKEN, title: 'T', description: '', images: [], fetchImpl: failing })
      .catch((e: Error) => e);
    expect(String(err2)).not.toContain(TOKEN);
  });
});
