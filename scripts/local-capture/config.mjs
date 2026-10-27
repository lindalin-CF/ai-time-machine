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
