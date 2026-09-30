// Minimal in-memory Env for calling the Worker handlers from Node:
// D1 is a shim over node:sqlite, KV is a Map, R2 is a Map with put() and ranged get().
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import type { Env } from '../../src/types';

type Row = Record<string, unknown>;

function d1(db: DatabaseSync) {
  const statement = (sql: string, args: unknown[] = []) => ({
    bind: (...a: unknown[]) => statement(sql, a),
    async first<T = Row>() { return (db.prepare(sql).get(...(args as never[])) ?? null) as T | null; },
    async all<T = Row>() { return { results: db.prepare(sql).all(...(args as never[])) as T[], success: true }; },
    async run() { db.prepare(sql).run(...(args as never[])); return { success: true }; },
  });
  return { prepare: (sql: string) => statement(sql) };
}

export function makeEnv() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../schema.sql', import.meta.url), 'utf8'));
  db.exec(`INSERT INTO portals (slug, name, company, url, brand) VALUES ('claude', 'Claude', 'Anthropic', 'https://claude.ai/', '#d97757')`);

  const kv = new Map<string, string>();
  const r2 = new Map<string, Uint8Array>();
  const r2Reads: { key: string; length: number }[] = [];
  const env = {
    DB: d1(db),
    CACHE: {
      async get(key: string, type?: string) {
        const v = kv.get(key);
        return v === undefined ? null : type === 'json' ? JSON.parse(v) : v;
      },
      async put(key: string, value: string) { kv.set(key, value); },
      async delete(key: string) { kv.delete(key); },
    },
    SHOTS: {
      async put(key: string, value: Uint8Array) { r2.set(key, value); },
      // Enough of R2 get() for image-size reads: an optional byte range, and arrayBuffer().
      async get(key: string, opts?: { range?: { offset?: number; length?: number } }) {
        const v = r2.get(key);
        if (!v) return null;
        const start = opts?.range?.offset ?? 0;
        const bytes = opts?.range?.length != null ? v.subarray(start, start + opts.range.length) : v.subarray(start);
        r2Reads.push({ key, length: bytes.length });
        return { async arrayBuffer() { return bytes.slice().buffer; } };
      },
    },
    UPLOAD_TOKEN: 'test-token',
  } as unknown as Env;
  return { env, db, kv, r2, r2Reads };
}
