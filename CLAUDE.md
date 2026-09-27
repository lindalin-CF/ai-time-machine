# CLAUDE.md

## Screenshot safety

Screenshots are irreplaceable: a portal's UI for a given week can never be captured again. These rules are permanent and apply to every task in this repo.

- **Never delete screenshot files** (PNG or any other image) anywhere: `scripts/local-capture/analysis/work/` folders, backups, temp downloads, `~/AI-Surface-Archive/`, or the R2 bucket `ai-portal-shots`. This includes `wrangler r2 object delete`, `wrangler r2 bucket delete`, and `rm` on image files. Move files you no longer need into `~/AI-Surface-Archive/` instead.
- **Archive before replacing anything in R2.** Before any `wrangler r2 object put` that replaces an existing screenshot, download the current object and save it to `~/AI-Surface-Archive/<r2_key>.<UTC timestamp>.png` (for example `~/AI-Surface-Archive/shots/2026-08-24/grok.local.png.20260926T191500Z.png`, timestamp from `date -u +%Y%m%dT%H%M%SZ`). Confirm the archived file is non-empty and byte-identical to the live object before uploading.
- **Never delete or overwrite anything in `~/AI-Surface-Archive/`.** Use a new timestamped name every time (`cp -n` / `mv -n`).
- **Never overwrite a local original.** Write edited versions under new names (for example `redacted-v2.png`, `redacted-v3.png`), and never pass an original as the output of `redact.mjs` or any other script.
- **To take a screenshot off the site, change what the site displays** (for example D1 data or the Worker's rendering), never remove the file from R2 or disk.
