-- Migration: mark the early system-test weeks. Screenshots are kept; only the analysis fields change.
-- Run once (after 0006_analysis_json.sql):
--   npm run db:migrate:system-test:remote
UPDATE captures
SET analysis_by = 'system-test',
    analysis = 'This week was captured during early system testing. The screenshots may not show the real product, so there is no design analysis.',
    analysis_json = NULL,
    analysis_version = NULL
WHERE week IN ('2026-07-20', '2026-08-03', '2026-08-10');
