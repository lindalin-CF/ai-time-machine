import puppeteer from "@cloudflare/puppeteer";
import type { Env, PortalRow, CaptureRow } from "./types";
import { getPortal, paletteFromBrand, upsertCapture, refreshWeekCount } from "./db";

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Capture a single portal for a given week:
 *  Browser Rendering -> PNG -> R2 -> Workers AI vision analysis -> D1.
 * Throws on hard failure so the Queue can retry.
 */
export async function capturePortal(env: Env, week: string, slug: string): Promise<void> {
  const portal = await getPortal(env, slug);
  if (!portal) throw new Error(`unknown portal: ${slug}`);

  const id = `${slug}-${week}`;
  const r2Key = `shots/${week}/${slug}.png`;

  let png: Uint8Array;
  try {
    png = await screenshot(env, portal);
  } catch (err) {
    // Record the failure so the gallery can show a graceful placeholder.
    await upsertCapture(env, baseRow(portal, week, id, null, "error"));
    await invalidate(env, week);
    throw err; // let the Queue retry
  }

  // Store the PNG bytes in R2.
  await env.SHOTS.put(r2Key, png, { httpMetadata: { contentType: "image/png" } });

  // Ask Workers AI to describe the design (best-effort).
  const analysis = await analyse(env, png, portal);

  const row: CaptureRow = {
    ...baseRow(portal, week, id, r2Key, "ok"),
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    palette: JSON.stringify(paletteFromBrand(portal.brand)),
    analysis: analysis.text,
    analysis_by: analysis.by,
  };
  await upsertCapture(env, row);
  await refreshWeekCount(env, week);
  await invalidate(env, week);
}

function baseRow(p: PortalRow, week: string, id: string, r2Key: string | null, status: string): CaptureRow {
  return {
    id, week, slug: p.slug, portal: p.name, company: p.company, url: p.url, brand: p.brand,
    r2_key: r2Key, width: VIEWPORT.width, height: VIEWPORT.height,
    palette: JSON.stringify(paletteFromBrand(p.brand)),
    analysis: "", analysis_by: "sample", status,
    captured_at: new Date().toISOString(),
  };
}

async function screenshot(env: Env, portal: PortalRow): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.goto(portal.url, { waitUntil: "networkidle2", timeout: 30000 });
    await new Promise((r) => setTimeout(r, portal.wait_for ?? 4000));
    const buf = (await page.screenshot({ type: "png", fullPage: false })) as Uint8Array;
    return buf;
  } finally {
    await browser.close();
  }
}

async function analyse(env: Env, png: Uint8Array, portal: PortalRow): Promise<{ text: string; by: string }> {
  const prompt =
    `You are a senior product designer writing one tight paragraph (3-4 sentences) of design analysis ` +
    `for a UI reference library. Describe the landing page of ${portal.name} by ${portal.company}: its layout, ` +
    `visual hierarchy, use of colour and typography, and how it guides the user to the primary action. ` +
    `Be specific and critical. Do not mention that this is a screenshot.`;
  try {
    const res: any = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", {
      image: [...png],
      prompt,
      max_tokens: 320,
    });
    const text = (res?.response ?? "").toString().trim();
    if (text.length > 20) return { text, by: "workers-ai" };
  } catch (_err) {
    // fall through to placeholder
  }
  return {
    text: `${portal.name} by ${portal.company}. Automated design analysis was unavailable for this capture; ` +
      `the screenshot is stored and can be re-analysed on the next weekly run.`,
    by: "sample",
  };
}

async function invalidate(env: Env, week: string): Promise<void> {
  await Promise.all([
    env.CACHE.delete(`cache:captures:${week}`),
    env.CACHE.delete(`cache:weeks`),
    env.CACHE.delete(`cache:stats`),
  ]);
}
