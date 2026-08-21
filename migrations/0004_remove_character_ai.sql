-- Migration: remove Character.AI from the active AI Surface Library.
-- Character.AI is character/roleplay entertainment rather than an LLM platform.
-- Run once:
--   npm run db:migrate:remove-character:remote
UPDATE portals SET active = 0 WHERE slug = 'character-ai';
DELETE FROM captures WHERE slug = 'character-ai';
UPDATE weeks
SET portal_count = (
  SELECT COUNT(*)
  FROM captures c
  JOIN portals p ON p.slug = c.slug
  WHERE c.week = weeks.week AND c.status = 'ok' AND p.active = 1
);
