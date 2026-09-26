// Minimal in-memory Env for calling the Worker handlers from Node:
// D1 is a shim over node:sqlite, KV is a Map, R2 only records puts.
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
    SHOTS: { async put(key: string, value: Uint8Array) { r2.set(key, value); } },
    UPLOAD_TOKEN: 'test-token',
  } as unknown as Env;
  return { env, db, kv, r2 };
}
