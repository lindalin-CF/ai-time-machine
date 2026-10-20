# CLAUDE.md

## Screenshot safety

Screenshots are irreplaceable: a portal's UI for a given week can never be captured again. These rules are permanent and apply to every task in this repo.

**What they protect: portal captures.** These are the R2 bucket `ai-portal-shots`, `~/AI-Surface-Archive/`, and the local originals and redacted files under `scripts/local-capture/` (including `analysis/work/` folders), plus any backup or temp download of those. Claude's own temporary QA screenshots in the session scratchpad (for example before/after shots of the site's UI) are not portal captures. They are not covered and can be deleted.

- **Never delete portal capture files** (PNG or any other image): `scripts/local-capture/` originals and redacted files (including `analysis/work/` folders), backups, temp downloads of captures, `~/AI-Surface-Archive/`, or the R2 bucket `ai-portal-shots`. This includes `wrangler r2 object delete`, `wrangler r2 bucket delete`, and `rm` on image files. Move files you no longer need into `~/AI-Surface-Archive/` instead.
- **Archive before replacing anything in R2.** Before any `wrangler r2 object put` that replaces an existing screenshot, download the current object and save it to `~/AI-Surface-Archive/<r2_key>.<UTC timestamp>.png` (for example `~/AI-Surface-Archive/shots/2026-08-24/grok.local.png.20260926T191500Z.png`, timestamp from `date -u +%Y%m%dT%H%M%SZ`). Confirm the archived file is non-empty and byte-identical to the live object before uploading.
- **Never delete or overwrite anything in `~/AI-Surface-Archive/`.** Use a new timestamped name every time (`cp -n` / `mv -n`).
- **Never overwrite a local original.** Write edited versions under new names (for example `redacted-v2.png`, `redacted-v3.png`), and never pass an original as the output of `redact.mjs` or any other script.
- **To take a screenshot off the site, change what the site displays** (for example D1 data or the Worker's rendering), never remove the file from R2 or disk.

## Deploying

- Always commit and push to main before telling the user to deploy. The live site must never be ahead of git.
