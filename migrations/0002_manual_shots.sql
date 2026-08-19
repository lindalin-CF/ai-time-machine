-- Migration: manual per-portal snapshots uploaded from the UI.
-- Run once on existing DB:
--   npm run db:migrate:manual:remote
CREATE TABLE IF NOT EXISTS manual_shots (
  id           TEXT PRIMARY KEY,
  slug         TEXT NOT NULL,
  portal       TEXT NOT NULL,
  device       TEXT NOT NULL DEFAULT 'desktop',
  description  TEXT DEFAULT '',
  r2_key       TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  FOREIGN KEY (slug) REFERENCES portals(slug)
);
CREATE INDEX IF NOT EXISTS idx_manual_shots_slug_created ON manual_shots(slug, created_at DESC);
