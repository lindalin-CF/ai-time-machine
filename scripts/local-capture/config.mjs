// Shared settings for capture.mjs and analysis/*.mjs.
// UPLOAD_TOKEN is only ever read from the environment; never hardcode it or write it to a file.
export const WORKER_URL = (process.env.WORKER_URL || "https://ai-portal-library.monthtest970509.workers.dev").replace(/\/$/, "");
export const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN;

// The account plan each portal is captured with now: "Free", "Pro" or "Enterprise" (src/plan.ts). capture.mjs sends
// it with every upload and the Worker stores it on the capture, so when an account changes plan, update it here only.
// A week whose plan differs from the week before is never shown as a product change.
export const PLANS = ["Free", "Pro", "Enterprise"];
export const DEFAULT_PLAN = "Free";
export const PORTAL_PLANS = {
  claude: "Pro",
  grok: "Pro",
  copilot: "Enterprise",
};

/** The current plan for a portal: its PORTAL_PLANS entry, or DEFAULT_PLAN. */
export function planFor(slug) {
  return PORTAL_PLANS[slug] ?? DEFAULT_PLAN;
}

// Pre-capture checklist (SETUP.md "Before you capture"). capture.mjs prints it at the start of a run, and each portal's
// note before that portal. A screenshot that breaks it shows account, session or capture-browser state rather than the
// product, and its analysis can't say anything changed (guideline 1.10.0, section 9.1).
export const PRE_CAPTURE_CHECKLIST = [
  "Dismiss every cookie or consent banner once in the capture profile (.capture-profile), so later runs don't show it.",
  "Each portal is on its start screen: no open conversation, room, popup or loading state.",
  "Muse: start screen with the chat list open, not inside a room or sub-chat room.",
];

// Per-portal reminders, printed before the portal is captured.
export const CAPTURE_NOTES = {
  // muse.ai reopens the last room. No URL is known that always opens the start screen, so check it by hand
  // (and don't use --auto for Muse until one is found; then set it in APP_URL in capture.mjs).
  muse: "Go back to Muse's start screen and open the chat list. Never capture inside a room: it shows a conversation.",
  qwen: "If the cookie banner is showing, dismiss it (and reload) before capturing.",
};

/** The reminder for a portal before it is captured, or null. */
export function captureNote(slug) {
  return CAPTURE_NOTES[slug] ?? null;
}
