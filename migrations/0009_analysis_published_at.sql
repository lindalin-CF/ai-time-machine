-- Migration: record when a guideline analysis was last published (POST /api/analysis), so
-- sitemap.xml <lastmod> and the RSS feed can date analysis updates, not only captures.
-- Nullable; existing rows keep NULL and fall back to captured_at. Run once, before deploying the
-- code that reads it:
--   npm run db:migrate:analysis-published:remote
ALTER TABLE captures ADD COLUMN analysis_published_at TEXT;
