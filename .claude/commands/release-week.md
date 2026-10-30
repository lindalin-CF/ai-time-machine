---
description: Release a week's held (redacted) captures so the site shows them, after /redact-week's upload
argument-hint: <week YYYY-MM-DD>
---

# Release week $ARGUMENTS

Local uploads from `capture.mjs` are **held**: the site never shows them (pages, API, feeds, `/img/<key>` all leave them out) and the week doesn't become the latest one until they are released. This command releases them once `/redact-week` has uploaded the redacted images. Weekly order: capture → `/redact-week` → upload all → **`/release-week`** → `/analyze-week` → publish all.

Paths below are relative to `scripts/local-capture/`. The site is `$WORKER_URL`, or `https://ai-portal-library.monthtest970509.workers.dev` if it's unset.

## Hard rules

- Never print, echo, log or write `UPLOAD_TOKEN`. Don't run `env`, `printenv` or `set`. The script reads it from the environment itself. To check it exists, use only `[ -n "$UPLOAD_TOKEN" ] && echo set || echo missing`; if it's missing, stop and ask the user to export it.
- Never release a capture that isn't redacted unless the user said exactly "release anyway <slug>" for that slug in this conversation. "release all" doesn't count for an unredacted capture.
- Nothing here deletes or changes an image. Releasing only sets `captures.held = 0`.

## 1. Check the argument and list held captures

`$ARGUMENTS` must match `YYYY-MM-DD`, or stop and ask. Then run:

```
node analysis/release-week.mjs $ARGUMENTS
```

It lists every held capture of the week and, for each image (desktop, mobile), whether it is redacted: the image the site serves now must have the SHA-1 of its `~/AI-Surface-Archive/redaction-ledger.json` row (`redacted_sha1` for `uploaded`, `original_sha1` for `no change`). Anything else (no ledger entry, `pending review`, `failed: …`, `not uploaded (excluded)`, or an image replaced after redaction) is **not redacted**.

Show the user the list as a table (portal, desktop, mobile, redacted yes/no with the reason). If nothing is held, say so and stop.

## 2. Release

- If every held capture is redacted, release them: `node analysis/release-week.mjs $ARGUMENTS --release`.
- If some aren't, tell the user which ones and why, release only the redacted ones with the same command (it refuses the rest by itself), and say the week stays off the homepage until the others are redacted (`/redact-week $ARGUMENTS`) or the user says "release anyway <slug>".
- Only after the user says "release anyway <slug>[, <slug>…]": `node analysis/release-week.mjs $ARGUMENTS --release --slug <slugs> --force <slugs>`. Name each forced slug in your reply.

The script calls `POST /api/weeks/$ARGUMENTS/release` (one portal at a time with `?slug=` when it isn't releasing the whole week), which also clears the KV caches.

## 3. Verify and report

The script then checks, without the token and cache-busted: the released captures are in `GET /api/captures?week=$ARGUMENTS`, their images answer 200, and, once nothing in the week is held, `GET /api/captures` (latest week) and the homepage show $ARGUMENTS. Report each check with ✓/✗, the captures still held (if any), and remind the user that the next step is `/analyze-week $ARGUMENTS`.
