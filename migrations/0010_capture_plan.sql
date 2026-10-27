-- The account plan each capture was taken with: 'Free' | 'Pro' | 'Enterprise' (src/plan.ts). Public, unlike the
-- analysis's private context.plan_tier_visible. New local captures send it from scripts/local-capture/config.mjs.
-- Backfill (2026-10-26): only sets plan; screenshots and analyses are untouched.
ALTER TABLE captures ADD COLUMN plan TEXT;

UPDATE captures SET plan = 'Free';
UPDATE captures SET plan = 'Pro' WHERE slug = 'claude';
UPDATE captures SET plan = CASE WHEN week >= '2026-10-19' THEN 'Pro' ELSE 'Free' END WHERE slug = 'grok';
UPDATE captures SET plan = CASE WHEN week >= '2026-08-24' THEN 'Enterprise' ELSE 'Free' END WHERE slug = 'copilot';
