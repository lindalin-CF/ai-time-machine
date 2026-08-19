import { routeAgentRequest } from "agents";
import type { Env, CaptureJob } from "./types";
import { handleApi, handleImage, isoMonday, weekLabel } from "./api";
import { capturePortal } from "./capture";

// Export the Workflow class so the runtime can find it (class_name in wrangler.jsonc).
export { CaptureWorkflow } from "./workflow";
// Export the voice Durable Object so the runtime can find it (class_name in wrangler.jsonc).
export { PortalVoiceAgent } from "./voice";

export default {
  // ---- HTTP: API + R2 image streaming; everything else falls through to static assets ----
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);
    try {
      // Voice agent WebSocket + control routes (/agents/portal-voice-agent/<name>).
      if (url.pathname.startsWith("/agents/")) {
        const routed = await routeAgentRequest(request, env);
        if (routed) return routed;
      }
      if (url.pathname.startsWith("/api/")) return await handleApi(request, env, ctx);
      if (url.pathname.startsWith("/img/")) return await handleImage(request, env);
    } catch (err) {
      return new Response(JSON.stringify({ error: String(err) }), {
        status: 500,
        headers: { "content-type": "application/json" },
      });
    }
    // Static assets (KUMO gallery). run_worker_first only routes /api + /img here,
    // but keep this fallback so direct navigations still resolve.
    return env.ASSETS.fetch(request);
  },

  // ---- Cron: weekly capture kickoff (Mondays 09:00 UTC) ----
  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const now = new Date();

    // Pause window: skip auto-capture while away so the cloud run (which can only
    // produce logged-out screenshots) doesn't create empty new weeks. Auto-resumes
    // after the end date — no redeploy needed. To cancel the pause early or change
    // the dates, edit these two constants (or set both to the same day) and redeploy.
    const PAUSE_FROM = Date.UTC(2026, 7, 28);            // Aug 28 2026 00:00 UTC (month is 0-indexed)
    const PAUSE_UNTIL = Date.UTC(2026, 8, 28, 23, 59, 59); // Sep 28 2026 23:59 UTC (inclusive)
    const t = now.getTime();
    if (t >= PAUSE_FROM && t <= PAUSE_UNTIL) {
      console.log(`[cron] auto-capture paused (away window) — skipped ${isoMonday(now)}`);
      return;
    }

    const week = isoMonday(now);
    ctx.waitUntil(
      env.CAPTURE_WORKFLOW.create({ params: { week, label: weekLabel(week) } }).then(() => undefined)
    );
  },

  // ---- Queue: one message == capture one portal for one week ----
  async queue(batch: MessageBatch<CaptureJob>, env: Env): Promise<void> {
    await Promise.all(
      batch.messages.map(async (msg) => {
        try {
          await capturePortal(env, msg.body.week, msg.body.slug);
          msg.ack();
        } catch (err) {
          console.error(`capture failed for ${msg.body.slug} (${msg.body.week}):`, err);
          msg.retry();
        }
      })
    );
  },
} satisfies ExportedHandler<Env, CaptureJob>;
