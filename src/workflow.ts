import { WorkflowEntrypoint, type WorkflowEvent, type WorkflowStep } from "cloudflare:workers";
import type { Env } from "./types";
import { listPortals, upsertWeek, refreshWeekCount } from "./db";

export interface CaptureParams {
  week: string;   // ISO Monday
  label: string;  // "Week of Aug 3, 2026"
}

/**
 * Durable weekly orchestration:
 *  1. ensure the week row exists + load the portal list (D1)
 *  2. fan out one capture job per portal onto the Queue
 *  3. sleep, then refresh the week's OK count
 * The heavy lifting (Browser Rendering + AI + R2) happens in the Queue consumer,
 * so a slow or failing portal never blocks the others and gets retried independently.
 */
export class CaptureWorkflow extends WorkflowEntrypoint<Env, CaptureParams> {
  async run(event: WorkflowEvent<CaptureParams>, step: WorkflowStep) {
    const env = this.env;
    const { week, label } = event.payload;

    const slugs = await step.do("prepare-week", async () => {
      await upsertWeek(env, week, label);
      const portals = await listPortals(env);
      return portals.map((p) => p.slug);
    });

    await step.do("enqueue-captures", async () => {
      // Queue.sendBatch accepts up to 100 messages; our portal list is well under that.
      await env.CAPTURE_QUEUE.sendBatch(slugs.map((slug) => ({ body: { week, slug } })));
      return slugs.length;
    });

    // Give the consumer time to work through the batch before finalising the count.
    await step.sleep("await-captures", "3 minutes");

    await step.do("finalise-week", async () => {
      await refreshWeekCount(env, week);
      return true;
    });
  }
}
