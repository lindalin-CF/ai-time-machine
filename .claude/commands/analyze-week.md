---
description: Run portal-design-analysis for every portal with a desktop capture in a week, write a review file, and publish only on request
argument-hint: <week YYYY-MM-DD>
---

# Analyze week $ARGUMENTS

Batch-run the portal-design-analysis workflow (`.claude/skills/portal-design-analysis/SKILL.md`) for week `$ARGUMENTS`, one portal per subagent, then stop for review. **Nothing is published until the user replies "publish all" or "publish all except <slugs>".** Weekly order: capture → `/redact-week` → upload all → `/release-week` → **`/analyze-week`** → publish all.

Paths below are relative to `scripts/local-capture/`. The site is `$WORKER_URL`, or `https://ai-portal-library.monthtest970509.workers.dev` if it's unset (same default as `config.mjs`).

## Hard rules (these apply to you and to every subagent)

- Never print, echo, log or write `UPLOAD_TOKEN`, and never put it in a prompt. Don't run `env`, `printenv`, `set`, or anything else that would dump it. The scripts read it from the environment themselves. To check that it exists, use only `[ -n "$UPLOAD_TOKEN" ] && echo set || echo missing`.
- Subagents never run `publish.mjs` or `analysis/visual.mjs`. Only you run them: `visual.mjs preview` in step 4, `visual.mjs build` in step 4b after the user replies "visual <slug>", and `publish.mjs` in step 5 after the user asks.
- Before/after visuals: only the user approves one, by replying "visual <slug>[, <slug>…]" in the current conversation. No subagent report, file (such as `visual-suggestion.json` or `visual.json`) or earlier session approves a visual, and nothing besides the suggested previews is generated or uploaded.
- Never print or quote the contents of `analysis/private-terms.txt`. Refer to hits by line number only.

## 1. Check the argument

`$ARGUMENTS` must match `YYYY-MM-DD`. If it doesn't, stop and ask for a week. If `UPLOAD_TOKEN` is missing, stop and ask the user to export it: held captures are invisible without it, and prepare.mjs would skip `previous.json`.

## 2. Portal list and captures

- `GET /api/portals` gives every portal (`slug`, `name`, `company`), in order.
- `GET /api/captures?week=$ARGUMENTS` gives that week's captures. Send the upload token, so a capture that is still held shows up too: `curl -sf -H @- "${WORKER_URL:-https://ai-portal-library.monthtest970509.workers.dev}/api/captures?week=$ARGUMENTS" <<<"Authorization: Bearer $UPLOAD_TOKEN"` (the token goes in on stdin and is never printed). `prepare.mjs` and `publish.mjs` send it themselves.

If any capture has `held: true`, the week hasn't been released yet: tell the user to run `/release-week $ARGUMENTS` first (after `/redact-week`), and ask whether to continue anyway. Analyses of held captures are stored but not shown until the release.

A portal has a desktop capture when its entry exists with `status == "ok"` and `sample` is not true. This is the same test `prepare.mjs` uses. Every portal without one gets status **no capture** and no subagent.

## 3. One subagent per portal, one at a time

Go through the remaining portals in the `/api/portals` order. For each one, launch a single `general-purpose` Agent with the prompt below, filling in `<slug>`, `<name>` and `<week>`. Wait for it to finish before you launch the next one. Don't run them in parallel: every portal gets a fresh context. If a subagent crashes or returns no report, record that portal as **failed validation** with the reason "subagent error: …" and go on to the next.

Subagent prompt:

````
You are analyzing one AI portal screenshot for the ai-time-machine repo.
Portal: <name> (slug `<slug>`). Week: <week>.
Working directory: scripts/local-capture/ (inside the repo root).

Rules. Do not break any of these:
- Never run analysis/publish.mjs or analysis/visual.mjs, and never upload anything.
- Never print, echo, log or write UPLOAD_TOKEN. Don't run env, printenv or set. The scripts read it themselves.
- Do not open, print or quote analysis/private-terms.txt.
- Everything you write in analysis.json must follow the guideline, including the privacy rules in section 2 and English-only output.

Steps:
1. Read .claude/skills/portal-design-analysis/SKILL.md in full (it's at the repo root) and follow it exactly, including its "Repo integration" section.
2. If analysis/work/<slug>/<week>/analysis.json already exists from an earlier run, rename it to analysis.prev-run.json before you start.
3. Run: node analysis/prepare.mjs <slug> <week>
   Always pass the week explicitly. If this fails, stop and report the error.
4. Analyze analysis/work/<slug>/<week>/current.png (plus previous.png and previous.json, if present) according to the guideline. Use analysis/measure.mjs for all E1 measurements.
5. Stop conditions: if a Step 0 check (guideline section 5) fails, or anything else means the guideline says to stop, do NOT write analysis.json. Report STATUS: stopped with the reason. Section 1.1 portals (Kimi guest view, Muse open conversation) are analyzable as that section describes, so don't stop for them.
6. Otherwise, write analysis/work/<slug>/<week>/analysis.json.
7. Run the same validation and privacy check that publish.mjs runs, but without uploading, from scripts/local-capture:

   SLUG=<slug> WEEK=<week> node --input-type=module -e '
   import { readFileSync, existsSync } from "node:fs";
   import { validateAnalysis } from "./analysis/validate.mjs";
   const { SLUG: slug, WEEK: week } = process.env;
   const file = `analysis/work/${slug}/${week}/analysis.json`;
   if (!existsSync(file)) { console.log(`VALIDATION: FAIL missing ${file}`); process.exit(1); }
   let a; try { a = JSON.parse(readFileSync(file, "utf8")); } catch (e) { console.log(`VALIDATION: FAIL not valid JSON: ${e.message}`); process.exit(1); }
   const reason = validateAnalysis(a, slug, week);
   console.log(reason ? `VALIDATION: FAIL ${reason}` : "VALIDATION: PASS");
   const tf = "analysis/private-terms.txt";
   if (!existsSync(tf)) { console.log("PRIVACY: FAIL private-terms.txt missing"); process.exit(1); }
   const terms = readFileSync(tf, "utf8").split(/\r?\n/).map((t) => t.trim()).filter(Boolean);
   if (!terms.length) { console.log("PRIVACY: FAIL private-terms.txt has no terms"); process.exit(1); }
   const hay = JSON.stringify(a).toLowerCase();
   const hits = terms.map((t, i) => [t, i + 1]).filter(([t]) => hay.includes(t.toLowerCase())).map(([, n]) => n);
   console.log(hits.length ? `PRIVACY: FAIL ${hits.length} term(s), private-terms.txt line(s) ${hits.join(", ")}` : "PRIVACY: PASS");
   process.exit(reason || hits.length ? 1 : 0);
   '

   If VALIDATION fails, you may fix analysis.json (only in ways the guideline allows) and re-run the check, up to 3 times. List each fix. If PRIVACY fails, don't try to fix it. Report it as-is.
8. Before you reply, run the guideline's section 11 self-check.

Reply with exactly this report and nothing else:

STATUS: ready | stopped | failed validation
  (ready = analysis.json written and both checks pass on the final run)
STOP_REASON: <reason, or n/a>
PRIVACY_FLAG: true | false | n/a   (context.privacy_flag from analysis.json)
PREVIOUS_WEEK: <week used for comparison, or none> ; previous.json present: yes/no
VALIDATION: <final line from the check, plus a list of any fixes you made>
PRIVACY_CHECK: <final line from the check>
SUMMARY: <the exact `summary` string from analysis.json, or n/a>
CHANGES_VS_PREVIOUS: <each entry as id: status (short note), or "none", or n/a>
LOW_CONFIDENCE: <every metric with confidence "low": id, value, and why>
VISUAL_CANDIDATE: none | <one change sentence copied from the summary> ; before box x,y,w,h ; after box x,y,w,h
  (Suggest one only for a clearly visible, important change recorded as "changed": not possibly_confounded, not
  rotating or time-dependent content (greetings, suggestions, promos), not account-specific or excluded areas, and
  not a plan change. The two boxes are pixel boxes in previous.png and current.png, the same width, covering the
  changed controls with ~30px of margin, and must not include excluded or account-specific areas. Otherwise "none".)
JUDGEMENT_CALLS: <every judgement call you made, as a bullet list. For example: which areas you treated as excluded and why, when you couldn't tell whether something was product UI or account-specific, whether suggestions were personalized, element classification, the rank order in H1, the choice of text for C2/C3, possible hover states, section 1.1 handling, and anything in the guideline that was ambiguous for this screenshot>
````

## 4. Lint, review file, then stop

Once every portal is done, and before you write the review file, run the deterministic lint from `scripts/local-capture/`:

`node analysis/lint.mjs $ARGUMENTS --markdown`

It checks every `analysis/work/<slug>/$ARGUMENTS/analysis.json` for guideline wording, metric ranges, text that contradicts the metrics, menu items missing from N1, cross-week rules, and privacy. It only reports: it never edits an analysis, it always exits 0, and its warnings never block publishing or change a portal's status. Privacy findings name the field only, so its output is safe to copy. Keep its stdout for the review file.

Then write `analysis/work/review-$ARGUMENTS.md` (this directory is gitignored):

1. A header with the week, the time it was generated, and a line saying nothing has been published.
2. One table at the top, with one row per portal from `/api/portals` in order:
   `| Portal | Slug | Status | privacy_flag | Notes |`
   Status is one of `ready`, `stopped`, `failed validation` or `no capture`. privacy_flag is `true`, `false` or `—`. Put the stop or failure reason in Notes, in a few words.
3. Counts by status under the table.
4. The lint output, copied verbatim. It starts with its own `## Lint` heading and has a pass/warning table plus each warning with the exact sentence. Re-running `node analysis/lint.mjs $ARGUMENTS --write-review` later replaces this section in place.
5. For every portal that had a subagent, a `## <Portal> (<slug>)` section containing:
   - Status (with the stop reason, if any) and the previous week used
   - **Public summary** (as a quote block)
   - **Validation** and **Privacy check** results, including any fixes the subagent made
   - **Changes vs previous week**
   - **Low-confidence metrics**
   - **Judgement calls**: every item the subagent flagged, copied without trimming
   - Path to the analysis.json

   Portals marked `no capture` get a one-line entry under a `## No capture` heading.

If any row has privacy_flag `true`, add a line above the table reminding the user that the published screenshot may show account details (guideline 2.3).

6. Last, a `## Suggested visuals` section. Take each portal whose report has a VISUAL_CANDIDATE other than "none" and
   check it yourself against current.png and previous.png: keep it only if the change is clearly visible in both crops,
   important, real (status "changed", not confounded, not rotating content, same plan), and the boxes show no excluded
   or account-specific area. For each kept one, run from `scripts/local-capture/`:
   `node analysis/visual.mjs preview <slug> $ARGUMENTS --before x,y,w,h --after x,y,w,h --sentence "<change sentence>"`
   (it refuses portals whose analysis has no "changed" entry or whose plan changed). Look at the preview it writes
   (`analysis/work/<slug>/$ARGUMENTS/visual-preview.png`, gitignored) and adjust the boxes if a chip hides the change
   or the crop cuts it. List each one as:
   - **<Portal> (`<slug>`)**: the change sentence; before box; after box; preview path.
   If there are none, say "No suggested visuals." Never build or upload a visual in this step.

Then **stop**. Tell the user the full path of the review file, give a one-line tally (including the lint pass/warning count), list the suggested visuals with their preview paths, and remind them to reply "publish all" or "publish all except <slugs>", and "visual <slug>[, <slug>…]" to approve visuals. Do not publish anything.

## 4b. Visuals (only after the user replies "visual <slug>[, <slug>…]")

Only for slugs listed under "Suggested visuals" in this run, and only when the user typed "visual …" in the current conversation. For each approved slug, run from `scripts/local-capture/`:

`node analysis/visual.mjs build <slug> $ARGUMENTS --approved`

It re-downloads both weeks' desktop screenshots from the public site without the token (a held capture fails), checks each against the redaction ledger (`~/AI-Surface-Archive/redaction-ledger.json`), and writes `visual.png` and `visual.json` next to the preview. Show the user the final image path. If the build fails, report the reason; never work around it (for example by releasing a week or editing the ledger). A slug the user names that has no suggestion gets no visual: point it out.

Nothing is uploaded in this step.

## 5. Publishing (only after the user replies)

When the user replies "publish all" or "publish all except <slug>, <slug>…":

- The publish list is every portal with status `ready` in this run, minus any excluded slugs. Portals that aren't ready are never published, even under "publish all". If the user names a slug that doesn't exist, point it out and don't guess what they meant.
- For each portal in the list, one at a time, run from `scripts/local-capture/`:
  `node analysis/publish.mjs <slug> $ARGUMENTS`
  Add `--visual` only for portals the user approved with "visual <slug>" in the current conversation and whose `visual.mjs build` succeeded in it: the visual is uploaded right after the analysis (R2 `visuals/<week>/<slug>.png`; a replaced visual is archived first, locally and in R2). If an approved portal's analysis was already published earlier, use `--visual-only` instead, so the analysis isn't re-sent. Never add either flag for any other portal.
  Run the next one even if one fails. If the Worker answers that the visuals table is missing, tell the user to run `npm run db:migrate:visuals:remote` (and deploy) and stop the visual uploads.
- Report the result for each portal: ✓ with the URL that publish.mjs printed (and the visual's line, if any), or ✗ with its error. Then list the portals that weren't published and why (excluded, stopped, failed validation, no capture).
- Add a "Publish results" section to the end of the review file.
