-- AI Portal Screenshot Library — D1 schema
-- Run: npm run db:init:local   (or db:init:remote)

DROP TABLE IF EXISTS captures;
DROP TABLE IF EXISTS weeks;
DROP TABLE IF EXISTS portals;

-- The AI/LLM portals we track every week.
CREATE TABLE portals (
  slug        TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  company     TEXT NOT NULL,
  url         TEXT NOT NULL,
  brand       TEXT NOT NULL,        -- hex brand colour
  wait_for    INTEGER DEFAULT 4000, -- ms to let the page settle before the shot
  full_page   INTEGER DEFAULT 1,    -- 1 = capture full scroll height
  active      INTEGER DEFAULT 1,
  sort_order  INTEGER DEFAULT 100
);

-- One row per captured week (the archive spine).
CREATE TABLE weeks (
  week         TEXT PRIMARY KEY,    -- ISO Monday, e.g. 2026-07-20
  label        TEXT NOT NULL,       -- "Week of Jul 20, 2026"
  created_at   TEXT NOT NULL,
  portal_count INTEGER DEFAULT 0
);

-- One row per (week, portal) screenshot.
CREATE TABLE captures (
  id           TEXT PRIMARY KEY,    -- <slug>-<week>
  week         TEXT NOT NULL,
  slug         TEXT NOT NULL,
  portal       TEXT NOT NULL,
  company      TEXT NOT NULL,
  url          TEXT NOT NULL,
  brand        TEXT NOT NULL,
  r2_key       TEXT,                -- key in the SHOTS bucket; NULL => use sample asset
  width        INTEGER DEFAULT 1280,
  height       INTEGER DEFAULT 800,
  palette      TEXT DEFAULT '[]',   -- JSON array of hex strings
  analysis     TEXT DEFAULT '',     -- design commentary
  analysis_by  TEXT DEFAULT 'sample', -- 'workers-ai' | 'sample'
  status       TEXT DEFAULT 'ok',   -- 'ok' | 'error' | 'pending'
  captured_at  TEXT NOT NULL,
  FOREIGN KEY (week) REFERENCES weeks(week),
  FOREIGN KEY (slug) REFERENCES portals(slug)
);

CREATE INDEX idx_captures_week ON captures(week);
CREATE INDEX idx_captures_slug ON captures(slug);
