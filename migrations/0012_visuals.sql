-- Before/after comparison images on the weekly digest (src/visuals.ts). One row per approved visual: a PNG at
-- visuals/<week>/<slug>.png in R2 (the same region cropped from the previous and this week's redacted desktop
-- screenshots), uploaded by scripts/local-capture/analysis/publish.mjs --visual only. A Worker deployed before this
-- migration shows no visuals and refuses POST /api/visual. A visual is never served or shown while either week's
-- capture is held.
CREATE TABLE IF NOT EXISTS visuals (
  id            TEXT PRIMARY KEY,    -- <slug>-<week>, the capture it belongs to
  slug          TEXT NOT NULL,
  week          TEXT NOT NULL,       -- the "after" week
  previous_week TEXT NOT NULL,       -- the "before" week
  r2_key        TEXT NOT NULL,       -- visuals/<week>/<slug>.png
  alt           TEXT NOT NULL,       -- the change sentence
  width         INTEGER NOT NULL,
  height        INTEGER NOT NULL,
  created_at    TEXT NOT NULL        -- upload time; also the image URL's cache-buster
);
