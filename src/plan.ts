// The account plan each capture was taken with (captures.plan, migration 0010): public, unlike the analysis's
// private context.plan_tier_visible. A capture whose plan differs from the same portal's previous capture is
// possibly confounded: its differences may come from the plan, not the product, so they are never shown as
// product changes (captureMetrics() in src/capture-metrics.ts). public/analytics-canvas.js has the same note.

export const PLANS = ["Free", "Pro", "Enterprise"] as const;
export type Plan = (typeof PLANS)[number];

export const isPlan = (v: unknown): v is Plan => typeof v === "string" && (PLANS as readonly string[]).includes(v);

/** Shown wherever a plan-change week's differences are listed. */
export const PLAN_CHANGE_NOTE = "This week's differences may come from the account plan change, not a product update.";

export type PlanChange = { from: Plan; to: Plan; status: "possibly_confounded"; reason: string };

/** A plan change between the previous capture and this one, or null when either plan is unknown or they match. */
export function planChange(previous: unknown, current: unknown): PlanChange | null {
  if (!isPlan(previous) || !isPlan(current) || previous === current) return null;
  return { from: previous, to: current, status: "possibly_confounded", reason: `account plan changed (${previous} → ${current})` };
}

/** "a Free account", "an Enterprise account". */
export const planAccount = (plan: Plan) => `${/^[AEIOU]/.test(plan) ? "an" : "a"} ${plan} account`;
