-- Hold new local captures until they are redacted (src/db.ts hasHeldColumn()). POST /api/upload sets held = 1;
-- public pages, the API and /img/<key> never show a held capture, and POST /api/weeks/<week>/release (the
-- /release-week command) sets it back to 0. Cloud (cron) captures are never held. Existing rows stay public (0).
ALTER TABLE captures ADD COLUMN held INTEGER NOT NULL DEFAULT 0;
