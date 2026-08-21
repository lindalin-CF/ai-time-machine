-- Migration: allow up to 5 images per manual snapshot card.
-- Run once:
--   npm run db:migrate:manual-images:remote
ALTER TABLE manual_shots ADD COLUMN images TEXT;
