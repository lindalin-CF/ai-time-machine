---
description: Run portal-design-analysis for every portal with a desktop capture in a week, write a review file, and publish only on request
argument-hint: <week YYYY-MM-DD>
---

# Analyze week $ARGUMENTS

Batch-run the portal-design-analysis workflow (`.claude/skills/portal-design-analysis/SKILL.md`) for week `$ARGUMENTS`, one portal per subagent, then stop for review. **Nothing is published until the user replies "publish all" or "publish all except <slugs>".**

Paths below are relative to `scripts/local-capture/`. The site is `$WORKER_URL`, or `https://ai-portal-library.monthtest970509.workers.dev` if it's unset (same default as `config.mjs`).

## Hard rules (these apply to you and to every subagent)

- Never print, echo, log or write `UPLOAD_TOKEN`, and never put it in a prompt. Don't run `env`, `printenv`, `set`, or anything else that would dump it. The scripts read it from the environment themselves. To check that it exists, use only `[ -n "$UPLOAD_TOKEN" ] && echo set || echo missing`.
- Subagents never run `publish.mjs`. Only you run it, in step 5, after the user asks.
- Never print or quote the contents of `analysis/private-terms.txt`. Refer to hits by line number only.

## 1. Check the argument

`$ARGUMENTS` must match `YYYY-MM-DD`. If it doesn't, stop and ask for a week. If `UPLOAD_TOKEN` is missing, warn that prepare.mjs will skip `previous.json` (so there will be no week-over-week comparison), then continue.

## 2. Portal list and captures

- `GET /api/portals` gives every portal (`slug`, `name`, `company`), in order.
- `GET /api/captures?week=$ARGUMENTS` gives that week's captures.

A portal has a desktop capture when its entry exists with `status == "ok"` and `sample` is not true. This is the same test `prepare.mjs` uses. Every portal without one gets status **no capture** and no subagent.

## 3. One subagent per portal, one at a time

Go through the remaining portals in the `/api/portals` order. For each one, launch a single `general-purpose` Agent with the prompt below, filling in `<slug>`, `<name>` and `<week>`. Wait for it to finish before you launch the next one. Don't run them in parallel: every portal gets a fresh context. If a subagent crashes or returns no report, record that portal as **failed validation** with the reason "subagent error: …" and go on to the next.

Subagent prompt:

````
You are analyzing one AI portal screenshot for the ai-time-machine repo.
Portal: <name> (slug `<slug>`). Week: <week>.
Working directory: scripts/local-capture/ (inside the repo root).

Rules. Do not break any of these:
- Never run analysis/publish.mjs, and never upload anything.
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
JUDGEMENT_CALLS: <every judgement call you made, as a bullet list. For example: which areas you treated as excluded and why, when you couldn't tell whether something was product UI or account-specific, whether suggestions were personalized, element classification, the rank order in H1, the choice of text for C2/C3, possible hover states, section 1.1 handling, and anything in the guideline that was ambiguous for this screenshot>
````

## 4. Review file, then stop

Once every portal is done, write `analysis/work/review-$ARGUMENTS.md` (this directory is gitignored):

1. A header with the week, the time it was generated, and a line saying nothing has been published.
2. One table at the top, with one row per portal from `/api/portals` in order:
   `| Portal | Slug | Status | privacy_flag | Notes |`
   Status is one of `ready`, `stopped`, `failed validation` or `no capture`. privacy_flag is `true`, `false` or `—`. Put the stop or failure reason in Notes, in a few words.
3. Counts by status under the table.
4. For every portal that had a subagent, a `## <Portal> (<slug>)` section containing:
   - Status (with the stop reason, if any) and the previous week used
   - **Public summary** (as a quote block)
   - **Validation** and **Privacy check** results, including any fixes the subagent made
   - **Changes vs previous week**
   - **Low-confidence metrics**
   - **Judgement calls**: every item the subagent flagged, copied without trimming
   - Path to the analysis.json

   Portals marked `no capture` get a one-line entry under a `## No capture` heading.

If any row has privacy_flag `true`, add a line above the table reminding the user that the published screenshot may show account details (guideline 2.3).

Then **stop**. Tell the user the full path of the review file, give a one-line tally, and remind them to reply "publish all" or "publish all except <slugs>". Do not publish anything.

## 5. Publishing (only after the user replies)

When the user replies "publish all" or "publish all except <slug>, <slug>…":

- The publish list is every portal with status `ready` in this run, minus any excluded slugs. Portals that aren't ready are never published, even under "publish all". If the user names a slug that doesn't exist, point it out and don't guess what they meant.
- For each portal in the list, one at a time, run from `scripts/local-capture/`:
  `node analysis/publish.mjs <slug> $ARGUMENTS`
  Run the next one even if one fails.
- Report the result for each portal: ✓ with the URL that publish.mjs printed, or ✗ with its error. Then list the portals that weren't published and why (excluded, stopped, failed validation, no capture).
- Add a "Publish results" section to the end of the review file.
