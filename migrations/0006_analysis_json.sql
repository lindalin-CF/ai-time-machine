-- Migration: store the full guideline analysis JSON and its guideline version.
-- Both columns are nullable; existing rows keep NULL and are not modified.
-- Run once:
--   npm run db:migrate:analysis:remote
ALTER TABLE captures ADD COLUMN analysis_json TEXT;
ALTER TABLE captures ADD COLUMN analysis_version TEXT;
