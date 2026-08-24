-- Migration: Insights memo/update posts.
-- Run once:
--   npm run db:migrate:insights:remote
CREATE TABLE IF NOT EXISTS insights (
  id           TEXT PRIMARY KEY,
  title        TEXT NOT NULL,
  description  TEXT DEFAULT '',
  images       TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_insights_created ON insights(created_at DESC);
