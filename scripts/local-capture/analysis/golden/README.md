# Golden set

15 published design analyses, split into sentences, for labelling by hand. These labels are the
reference that later evaluations of the guideline (`.claude/skills/portal-design-analysis/SKILL.md`)
are scored against.

- `<slug>-<week>.json` holds one analysis: the published `summary_sentences` (each with an empty `label`
  and `note`), the redacted screenshot path for that week and, when there is one, for the previous week,
  and the `changes_vs_previous` statuses.
- `review.html` is the labelling page. Open it from disk. It makes no network requests (its CSP blocks
  them). Use **Open golden folder** to label and save in place (Chrome/Edge). Otherwise use
  **Open JSON files…** and replace each file with the copy that **Save** downloads.
- `build.mjs` made the files. It never overwrites an existing file, because the file may already hold labels.

Labels: `correct` (the screenshot supports the sentence), `wrong` (the screenshot contradicts it), `unsure`.
Add a `note` for every `wrong` or `unsure` label.

## Selection

Ten portals: two weeks each for ChatGPT, Claude, Gemini, Grok and Meta AI, and one each for Le Chat,
Perplexity, Qwen, Pi and Muse, spread across guideline versions 1.3 to 1.6. Seven are confounded weeks, where pop-ups,
promo cards, rotating headings or an open conversation produced `possibly_confounded` changes. Each
file's `why_selected` says why it was picked.

Every summary was checked against the live site's published text on 2026-10-25. No published
analysis has a `confounded` status, so the confounded picks are `possibly_confounded` weeks. The
system-test weeks (2026-07-20, 08-03, 08-10) aren't included. They have no design analysis, only a fixed
notice, and they have no redacted screenshots.

## Screenshots

Paths always point at the redacted file listed in `~/AI-Surface-Archive/redaction-ledger.json`. `build.mjs`
checks it against the ledger's redacted SHA-1 and rejects anything that matches the original. The images
are in the gitignored `analysis/work/redact/` folder, so they exist only on the capture machine. Weeks
whose ledger entry is "no change" have no redacted file. Their previous-week screenshot is left out, so
the page never shows an unredacted capture.
