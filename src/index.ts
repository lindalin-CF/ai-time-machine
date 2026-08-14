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
    const week = isoMonday(new Date());
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
