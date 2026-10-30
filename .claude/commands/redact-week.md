---
description: Redact account details from every public screenshot in a week (desktop + mobile), build a local review page, and upload only on request
argument-hint: <week YYYY-MM-DD>
---

# Redact week $ARGUMENTS

Batch-redact the public screenshots for week `$ARGUMENTS`, one portal per subagent, then stop for review. **Nothing is uploaded until the user replies "upload all" or "upload all except <slug/variant>, …".** Weekly order: capture → **`/redact-week`** → upload all → `/release-week` → `/analyze-week` → publish all.

Paths below are relative to `scripts/local-capture/` unless they start with `~`. `W` = `analysis/work/redact/$ARGUMENTS` (gitignored). The site is `$WORKER_URL`, or `https://ai-portal-library.monthtest970509.workers.dev` if it's unset. Bucket `ai-portal-shots`, D1 `ai-portal-library`, KV namespace id `5c7252cb79964f8cab90d2171096c386`, KV key prefix = `CACHE_VERSION` in `src/db.ts`. Run every wrangler command with `npx wrangler … --remote` from the repo root.

## Hard rules (you and every subagent)

CLAUDE.md "Screenshot safety" applies in full. In particular:

- Never delete, move away, or overwrite any image, anywhere (local, `~/AI-Surface-Archive/`, R2). No `rm` on images, no `wrangler r2 object delete`. Use `set -o noclobber` / `cp -n` and check `[ -e … ]` before every write. If a target name exists, pick a new suffix (`redacted-desktop-v2.png`, …).
- Never pass an original as the output of `redact.mjs` or of the fill snippet below.
- Archive before every R2 replacement (step 6), byte-identical, non-empty.
- Subagents never upload, never touch D1/KV/R2 writes, and never edit the ledger.
- Reports, the ledger and the review page describe covered text **by category only**. Never write the covered text itself anywhere.
- `~/AI-Surface-Archive/redaction-ledger.json` is the only file in the archive that is ever rewritten. Before every rewrite, `cp -n` the current ledger to `~/AI-Surface-Archive/redaction-ledger.json.<UTC ts>.json`.

## 1. Check the argument and list images

`$ARGUMENTS` must match `YYYY-MM-DD`, or stop and ask.

`GET /api/portals` (order) and `GET /api/captures?week=$ARGUMENTS` **with the upload token**, because new local captures are held and only show up with it: `curl -sf -H @- "${WORKER_URL:-https://ai-portal-library.monthtest970509.workers.dev}/api/captures?week=$ARGUMENTS" <<<"Authorization: Bearer $UPLOAD_TOKEN"` (the token goes in on stdin; never print, echo or log it, and don't run `env`, `printenv` or `set`; check it exists only with `[ -n "$UPLOAD_TOKEN" ] && echo set || echo missing`, and if it's missing, stop and ask the user to export it). Each entry has `held`. A portal has a capture when its entry has `status == "ok"` and `sample` is not true. Its images are the desktop key (from `image`, strip `/img/` and the query) and, if `imageMobile` is set, the mobile key. Other portals: **no capture**.

## 2. Ledger pre-check

Read `~/AI-Surface-Archive/redaction-ledger.json` (create it as `{"version":1,"images":[]}` if missing). Ledger rows look like:

```json
{ "r2_key": "shots/2026-08-24/grok.local.png", "week": "2026-08-24", "slug": "grok", "variant": "desktop",
  "original_sha1": "…", "redacted_sha1": "…", "previous_redacted_sha1": [],
  "redacted_file": "scripts/local-capture/analysis/work/…", "boxes": [{"x":0,"y":0,"w":0,"h":0,"fill":"#RRGGBB","shape":"rect","category":"…"}],
  "result": "redacted | no change", "date": "YYYY-MM-DD", "upload_status": "pending review | uploaded | not uploaded (excluded) | no change | failed: …",
  "uploaded_at": null, "archived_before_upload": [], "notes": "" }
```

For every image, get the live SHA-1 without writing a file: `npx wrangler r2 object get ai-portal-shots/<key> --remote --pipe | shasum`. If it equals any `redacted_sha1` (or `previous_redacted_sha1` entry) in the ledger, mark the image **skipped (already redacted)** and don't give it to a subagent. If both images of a portal are skipped, the portal gets no subagent.

## 3. One subagent per portal

Launch one `general-purpose` Agent per remaining portal (fresh context each), in batches of up to 5 in parallel. Fill in `<slug>`, `<name>`, `<week>`, and for each image its variant, R2 key and live SHA-1. If a subagent crashes or returns no report, record its images as **error** and continue.

Subagent prompt:

````
You are redacting account details from the public screenshots of one AI portal for the ai-time-machine repo.
Portal: <name> (slug `<slug>`). Week: <week>.
Images (variant, R2 key, live SHA-1 at pre-check):
<list>
Repo root: /Users/linjiaqi/Projects/ai-time-machine. Work in scripts/local-capture/. Your folder: D = analysis/work/redact/<week>/<slug>/

Rules. Do not break any of these:
- Read /Users/linjiaqi/Projects/ai-time-machine/CLAUDE.md "Screenshot safety" first. Never delete, move or overwrite any image. Before creating any file, check it doesn't exist; use `set -o noclobber` for redirects and `cp -n` for copies. If a name is taken, use a new suffix (-v2, -v3, …).
- Never upload, never run wrangler put/delete, never touch D1 or KV, never edit ~/AI-Surface-Archive/redaction-ledger.json.
- Never write the covered text itself anywhere (report, report.json, filenames, your reply). Describe by category only.
- Don't open or print analysis/private-terms.txt.

Steps, for each image:
a. Download and archive:
   mkdir -p D; set -o noclobber
   (from the repo root) npx wrangler r2 object get ai-portal-shots/<key> --remote --pipe > scripts/local-capture/D/original-<variant>.png
   If original-<variant>.png already exists, don't download; instead check its SHA-1 equals the live SHA-1 and reuse it (if it differs, stop for this image and report it).
   Check the SHA-1 equals the live SHA-1 given above, and the file is non-empty.
   Then, before anything else: TS=$(date -u +%Y%m%dT%H%M%SZ); mkdir -p ~/AI-Surface-Archive/$(dirname <key>); cp -n D/original-<variant>.png ~/AI-Surface-Archive/<key>.$TS.png; confirm with cmp that the archive copy is byte-identical.
b. If analysis/work/<slug>/<week>/analysis.json exists, read metrics[id=L1].value entries whose region is "account-specific area (excluded)". Their location [x,y,w,h] is desktop CSS px rounded to 10. Hints only; they describe the desktop image only.
c. View each image (Read tool). To read small text, write zoomed crops into D/crops/ (new names only), e.g.
   node --input-type=module -e 'import{PNG}from"pngjs";import{readFileSync,writeFileSync,existsSync}from"fs";const[i,o,x,y,w,h,z="3"]=process.argv.slice(1);if(existsSync(o))throw Error("exists");const s=PNG.sync.read(readFileSync(i)),Z=+z,d=new PNG({width:w*Z,height:h*Z});for(let r=0;r<h*Z;r++)for(let c=0;c<w*Z;c++){const si=(((+y+(r/Z|0))*s.width)+(+x+(c/Z|0)))*4,di=(r*w*Z+c)*4;for(let k=0;k<4;k++)d.data[di+k]=s.data[si+k]}writeFileSync(o,PNG.sync.write(d))' D/original-desktop.png D/crops/desktop-sidebar.png 0 300 260 500 3
   Cover: the account holder's name, emails, usernames/handles, conversation or chat titles and previews (history lists, recents, search results), project and folder names, custom or organization agent/bot/GPT/gem names, workspace or organization names, and any other person's name.
   Avatars (photos or initials badges) are covered with a circle mask that keeps their position (see d), category "avatar", in weeks from 2026-10-19 onward. In weeks before 2026-10-19, leave avatars as they are and don't flag them (CLAUDE.md "Avatars in screenshots"); still cover every other item in this list.
   Keep visible: all product UI (nav labels, built-in model/agent names, buttons, suggestion chips, plan badges like "Free"/"Pro", legal text, promo copy).
   Names, emails, usernames and other identifying details are ALWAYS covered, even inside open conversation content (for example an assistant message or greeting in the main pane that addresses the account holder by name). Cover just those words, not the surrounding message.
   Do NOT cover the rest of open conversation content (messages in the main pane). Flag it as "open conversation, needs decision" instead.
   If unsure whether something is product UI or account-specific, flag it as uncertain; cover it only if it plausibly identifies the account.
d. For each item, get a tight box: node analysis/measure.mjs extent D/original-<variant>.png <x> <y> <w> <h>
   using a search box that contains only that text (not an avatar or icon next to it). Pad bbox_css_px by 4px on every side, round outward to integers, clamp to the image. Coordinates are image pixels when measure size reports scale 1 or null (both 1280x800 desktop and non-16:10 mobile images); if scale is 2+, multiply by scale.
   Fill color: sample the background right next to the box (measure.mjs colors at 2–3 points just outside it, e.g. 2px left and right of the padded box at mid-height) and use the median/common value. If the neighbours differ (gradient, selected row highlight), split the box or pick the colour that surrounds most of it, and note it.
   Make sure a padded text box never overlaps an avatar mask, icon or other product UI; shrink it on that side if needed.
   Avatars: measure the avatar's own edge (measure.mjs extent on a search box around just the avatar), then grow the box by 2px on every side so the circle also covers the anti-aliased rim, round outward and clamp. Mark it "circle". Colour: sample 2–3 points just outside the circle (measure.mjs colors); if the median sample is dark ((R+G+B)/3 < 128) use #5f5f5f, otherwise #c8c8c8. Never use the avatar's own colour.
   Write the redacted image in one pass from the original, with a colour per box (no intermediate files). A box is [x,y,w,h,"#RRGGBB"] for a rectangle or [x,y,w,h,"#RRGGBB","circle"] for an avatar; a circle fills only the ellipse inside its box and leaves the pixels outside it unchanged. The fill is analysis/fill-boxes.mjs, the same code analysis/redact.mjs uses (run from scripts/local-capture):
   OUT=D/redacted-<variant>.png BOXES='[[x,y,w,h,"#RRGGBB"],[x,y,w,h,"#5f5f5f","circle"],...]' node --input-type=module -e 'import{PNG}from"pngjs";import{readFileSync,writeFileSync,existsSync}from"fs";import{resolve}from"path";import{fillBoxes}from"./analysis/fill-boxes.mjs";const[i]=process.argv.slice(1),o=process.env.OUT;if(existsSync(o)||resolve(i)===resolve(o))throw Error("refusing to overwrite "+o);const p=PNG.sync.read(readFileSync(i));for(const b of fillBoxes(p,JSON.parse(process.env.BOXES)))console.log("filled",b.shape,b.x,b.y,b.w,b.h,b.fill);writeFileSync(o,PNG.sync.write(p),{flag:"wx"});console.log("wrote",o)' D/original-<variant>.png
   View the result (and zoomed crops of each box, new names in D/crops/) and confirm: nothing readable remains (no partial letters, descenders or ellipses), no avatar rim or initial shows around a circle, fills blend in, and product UI is intact. If not, write a new version (redacted-<variant>-v2.png, …) from the ORIGINAL, never from a redacted file, and report the final one.
e. If an image needs no redaction, record "no change" and write no redacted file.
f. Write D/report.json (new file; if it exists use report-v2.json, …):
   {"slug":"<slug>","week":"<week>","images":[{"variant":"desktop","r2_key":"…","original_file":"analysis/work/redact/…/original-desktop.png","original_sha1":"…","archive_path":"~/AI-Surface-Archive/…","result":"redacted"|"no change"|"error","redacted_file":"…"|null,"redacted_sha1":"…"|null,"boxes":[{"x":0,"y":0,"w":0,"h":0,"fill":"#RRGGBB","shape":"rect"|"circle","category":"…"}],"flags":["open conversation, needs decision: <where, no content>"],"uncertain":["…"],"needs_decision":true|false,"notes":"…"}]}
   category is one of: avatar, account name, email, username, conversation title, conversation preview, project or folder name, custom agent name, workspace or organization name, other person's name, other (explain in notes without quoting text).
   needs_decision is true if there's any flag or anything uncertain.

Reply with exactly this report and nothing else, one block per image:

IMAGE: <variant> <r2_key>
RESULT: redacted | no change | error (<reason>)
ORIGINAL: <path> sha1=<…> ; ARCHIVED: <path> (cmp identical: yes/no)
REDACTED: <path> sha1=<…> | none
BOXES: <x,y,w,h fill #hex [circle] — category> per line, or none
FLAGS: <list or none>
UNCERTAIN: <list or none>
NEEDS_DECISION: yes | no
````

## 4. Ledger rows

For every image a subagent returned, add or update its ledger row (snapshot the ledger first): `original_sha1`, `redacted_sha1` (null for no change), `redacted_file`, `boxes`, `result`, `date` (today UTC), `upload_status` = `pending review` or `no change`. Verify each redacted file's SHA-1 yourself before writing it.

## 5. Review page, then stop

Write `W/review.html` (local only, never deployed or published). Use relative image paths (`<slug>/original-desktop.png`). For each image: portal, variant, R2 key, result, the original and redacted version side by side, each at least 600px wide (mobile ~390px), with click-to-open-full-size, the list of boxes with categories and fill colours, flags and uncertain items. Order: images with `needs_decision` first, then redacted, then no change, then skipped/error. Draw a thin outline of each box on the original (absolutely positioned divs scaled to the displayed size; circle boxes get `border-radius: 50%`) so the reviewer can see what was covered. Put a summary table at the top.

Then **stop**. Give the user the full path of `review.html`, a one-line tally (redacted / no change / needs decision / skipped / error), and remind them to reply "upload all" or "upload all except <slug/variant>, …". Upload nothing.

## 6. Upload (only after the user replies)

Upload list = every image whose ledger row is `pending review` for this week, minus exclusions (`chatgpt/mobile`, or `chatgpt` for both variants). Images still flagged `needs_decision` are included only if the user's reply covers them; if unclear, ask. If the user names a slug/variant that isn't in the list, say so and don't guess.

Run the reusable upload script from `scripts/local-capture/` (don't write a new one):

```
node analysis/upload-redacted.mjs $ARGUMENTS [--except slug/variant,slug,...] [--dry-run]
```

Pass the user's exclusions with `--except` (a bare slug excludes both variants). Run `--dry-run` first if anything looks off; it touches nothing. The script handles each image one at a time and stops only that image on a failed check, marking its ledger row `failed: <reason>`. For each image it:

1. Archives the live R2 object to `~/AI-Surface-Archive/<key>.<UTC ts>.png` (never overwriting; a taken name gets `-2`, `-3`, …), checks it is non-empty and byte-identical to a second fresh read, and checks the live SHA-1 equals the row's `expected_live_sha1` if set, otherwise `original_sha1`. Set `expected_live_sha1` (and move the old `redacted_sha1` into `previous_redacted_sha1`) when replacing an earlier redaction.
2. Uploads `redacted_file` with `wrangler r2 object put`.
3. Verifies a cache-busted site download and a fresh R2 read both equal `redacted_sha1`.
4. Updates the ledger (snapshotting it first): `upload_status: "uploaded"`, `uploaded_at`, archive path appended to `archived_before_upload`.
5. Bumps `captured_at` by 1 ms with a guarded `UPDATE` (`changes` must be 1).
6. Deletes the KV keys `invalidate()` in `src/capture.ts` deletes (`CACHE_VERSION` and the KV id are read from `src/db.ts` and `wrangler.jsonc`).

It never deletes an image, an R2 object or an archive file (the KV cache keys are the only thing it deletes). If you need a step it doesn't cover, stop and ask rather than improvising a replacement.

The script sends `UPLOAD_TOKEN` for the site check (held images are a 404 without it); it reads the token from the environment and never prints it.

Report each image from the script's output: ✓ (archive path, new SHA-1, new captured_at) or ✗ with the reason. Also confirm the site's API image URLs (`GET /api/captures?week=…` and the `/img/…` URLs, both with the token header as in step 1) serve the new SHA-1s. Then list images not uploaded and why. Add an "Upload results" section to `review.html`.

## 7. Then remind the user to release

The week's captures are still **held**: the site shows none of them, and keeps the previous week as the latest, until they are released. **Don't release anything yourself.** End by reminding the user to run `/release-week $ARGUMENTS`, which checks every held capture against the ledger and refuses unredacted ones.
