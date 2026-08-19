# Setup & workflow (work from any computer)

Everything that matters lives in the cloud, not on any single laptop:

| Thing | Where it lives | Affected by switching computers? |
| --- | --- | --- |
| Source code | GitHub — `lindalin-CF/ai-time-machine` | No — just `git clone` it |
| Live website | Your Cloudflare account (`*.workers.dev`) | No — `npm run deploy` updates it |
| Database (D1) & screenshots (R2) | Cloudflare | No — always in the cloud |
| Upload secret (`UPLOAD_TOKEN`) | Cloudflare secret | No — already set, don't redo |
| Login sessions (`.capture-profile/`) | **Only the laptop you captured from** | **Yes** — re-login once on a new machine |

Live site: <https://ai-portal-library.monthtest970509.workers.dev>

---

## One-time setup on a new computer (macOS)

### 1. Install the tools

```bash
# Homebrew (skip if you already have it)
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"

# Node.js, Git, and the GitHub CLI
brew install node git gh
```

### 2. Get the code

```bash
cd ~/Desktop                       # or wherever you keep projects
git clone https://github.com/lindalin-CF/ai-time-machine.git
cd ai-time-machine
npm install
```

### 3. Log in to the two accounts (these are different things)

```bash
# GitHub — lets you PUSH code
gh auth login          # choose: GitHub.com -> HTTPS -> log in with a browser

# Cloudflare — lets you DEPLOY the website
npx wrangler login     # opens a browser; log into the account that owns ai-portal-library
```

Confirm you're on the right Cloudflare account (important if you have more than one):

```bash
npx wrangler whoami
```

> `wrangler deploy` deploys to whichever Cloudflare account you're logged into
> (there is no `account_id` pinned in `wrangler.jsonc`).

---

## Daily workflow (every time you make a change)

```bash
git pull origin main       # 1. ALWAYS pull first (see the two-computer rule below)
# ...make your edits...
git add -A
git commit -m "describe what you changed"
git push origin main       # 2. push code to GitHub
npm run deploy             # 3. deploy the site to Cloudflare
```

Then hard-refresh the site to clear the browser cache: **Cmd + Shift + R**.

### Do I need `npm install`?

Only when a change adds a **new package** — i.e. when `git pull` changes
`package.json`. Pure front-end / bug-fix / style changes don't need it. When in
doubt, running `npm install` again is harmless (it just confirms everything's there).

---

## ⚠️ The one rule when using two computers

**Always `git pull origin main` before you start editing.**

If you push from laptop A, then edit on laptop B without pulling first, the two
diverge and your next push is rejected with a conflict. Habit to keep:
**pull before you start, push when you finish.**

If a push is ever rejected as out of date:

```bash
git pull --rebase origin main    # replay your commits on top of the latest
# resolve conflicts if any, then:
git push origin main
```

---

## Re-capturing screenshots on a new computer

The screenshots come from a script that runs on **your** machine (your home IP +
your real logins), because the AI portals block datacenter IPs. See
`scripts/local-capture/`.

Because the login sessions in `.capture-profile/` are **not** in Git, the first
run on a new computer needs a fresh login to each portal:

```bash
cd scripts/local-capture
npm install                                  # first time only
UPLOAD_TOKEN=<the same token you set in Cloudflare> node capture.mjs
```

- A Chrome window opens. When it stops on each portal, log in, then press **Enter**
  to capture. Logins are saved to `.capture-profile/` and reused next time.
- The script will **not** upload a logged-out page — if it still looks logged out
  it asks you to log in and retry (or `s` to skip).
- `UPLOAD_TOKEN` must match the Cloudflare secret. You set it once with
  `npx wrangler secret put UPLOAD_TOKEN`; it stays in the cloud, so you only need
  to pass the same value on the command line when running the script.

Other options:

```bash
node capture.mjs claude chatgpt    # only specific portals (by slug)
node capture.mjs --auto            # no pausing (use once you're already logged in)
node capture.mjs --auto --wait=10  # wait 10s per page before capturing (default 6)
node capture.mjs --week=2026-08-10 # store under a specific week
```

---

## Weekly auto-capture (cron) & the pause window

The site auto-captures every **Monday 09:00 UTC** (cron in `wrangler.jsonc`). It
only **adds a new week** of data — it never changes the code or the UI, and it
never overwrites screenshots you uploaded yourself (`.local.png`).

Important limitation: the cron runs in Cloudflare's cloud, which **can't log in
and doesn't take mobile shots**. So automatic weeks are **logged-out desktop
only**. To get signed-in + mobile shots for a week, run the local capture script
yourself that week (`node capture.mjs --auto`).

### Pause: Aug 28 – Sep 28, 2026 (already set)

Because those weeks would otherwise fill up with empty logged-out screenshots
while away, auto-capture is **paused** for that window. It skips these Mondays:
Aug 31, Sep 7, Sep 14, Sep 21, Sep 28 — and **auto-resumes on Oct 5** with no
redeploy needed.

- The pause lives in `src/index.ts` → `scheduled()` as two constants:
  `PAUSE_FROM` and `PAUSE_UNTIL`.
- To change or cancel it: edit those dates (or set both to the same day to
  effectively disable the pause), then `npm run deploy`.
- Plan: run `node capture.mjs --auto` on Aug 28 before leaving, so the latest
  week shows good signed-in + mobile shots the whole time you're away.

---

## Handy commands

```bash
npm run dev            # run the site locally at http://localhost:8787
npm run deploy         # deploy to Cloudflare
npx wrangler whoami    # check which Cloudflare account you're on
git status             # see what you've changed
git log --oneline -5   # recent commits
```
