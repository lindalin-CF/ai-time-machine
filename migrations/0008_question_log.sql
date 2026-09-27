-- Migration: anonymous question log for the voice guide (src/question-log.ts).
-- Only the scrubbed question text, the UTC date (no time) and the input type. No room name, IP,
-- user agent, country or session; the id is a random UUID. Rows older than 360 days are deleted by
-- the daily cron. Run once:
--   npm run db:migrate:question-log:remote
CREATE TABLE IF NOT EXISTS question_log (
  id        TEXT PRIMARY KEY,                                  -- random UUID
  day       TEXT NOT NULL,                                     -- YYYY-MM-DD (UTC)
  input     TEXT NOT NULL CHECK (input IN ('typed', 'voice')),
  question  TEXT NOT NULL                                      -- scrubbed, at most 1,000 characters
);
CREATE INDEX IF NOT EXISTS idx_question_log_day ON question_log(day);
