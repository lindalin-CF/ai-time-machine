-- Migration: add a mobile screenshot key to captures.
-- Safe to run once on an existing database (local or remote) without losing data.
--
--   npm run db:migrate:local     (or)     npm run db:migrate:remote
--
-- Adding a column defaults existing rows to NULL (= no mobile capture yet),
-- so the app keeps working until mobile screenshots are captured.
ALTER TABLE captures ADD COLUMN r2_key_mobile TEXT;
