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

const USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

async function screenshot(env: Env, portal: PortalRow): Promise<Uint8Array> {
  const browser = await puppeteer.launch(env.BROWSER);
  try {
    const page = await browser.newPage();
    await page.setViewport(VIEWPORT);
    await page.setUserAgent(USER_AGENT);

    // If a COOKIES_<SLUG> secret is set, inject the logged-in session BEFORE navigating.
    const cookies = loadCookies(env, portal.slug);
    const authed = cookies.length > 0;
    if (authed) {
      try {
        await page.setCookie(...(cookies as Parameters<typeof page.setCookie>));
        console.log(`injected ${cookies.length} cookie(s) for ${portal.slug}`);
      } catch (err) {
        console.error(`setCookie failed for ${portal.slug}:`, err);
      }
    }

    // Authenticated pages redirect/hydrate more, so be a little more patient.
    const timeout = authed ? 45000 : 30000;
    const settle = authed ? Math.max(portal.wait_for ?? 4000, 6000) : (portal.wait_for ?? 4000);
    await page.goto(portal.url, { waitUntil: "networkidle2", timeout });
    await new Promise((r) => setTimeout(r, settle));
    const buf = (await page.screenshot({ type: "png", fullPage: false })) as Uint8Array;
    return buf;
  } finally {
    await browser.close();
  }
}

/** Secret name for a portal's cookies, e.g. "chatgpt" -> "COOKIES_CHATGPT", "meta-ai" -> "COOKIES_META_AI". */
export function cookieSecretName(slug: string): string {
  return "COOKIES_" + slug.toUpperCase().replace(/[^A-Z0-9]/g, "_");
}

/** True if a cookies secret is configured for this portal (used by /api/auth/status). */
export function hasCookieSecret(env: Env, slug: string): boolean {
  const v = (env as unknown as Record<string, unknown>)[cookieSecretName(slug)];
  return typeof v === "string" && v.trim().length > 0;
}

interface NormalizedCookie {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  expires?: number;
  httpOnly?: boolean;
  secure?: boolean;
  sameSite?: "Strict" | "Lax" | "None";
}

/** Read + normalize the COOKIES_<SLUG> secret (Cookie-Editor / EditThisCookie JSON) into Puppeteer cookies. */
function loadCookies(env: Env, slug: string): NormalizedCookie[] {
  const raw = (env as unknown as Record<string, unknown>)[cookieSecretName(slug)];
  if (typeof raw !== "string" || !raw.trim()) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error(`COOKIES secret for ${slug} is not valid JSON:`, err);
    return [];
  }
  const arr = Array.isArray(parsed) ? parsed : (parsed as { cookies?: unknown[] })?.cookies;
  if (!Array.isArray(arr)) return [];

  const out: NormalizedCookie[] = [];
  for (const item of arr) {
    const c = item as Record<string, unknown>;
    if (!c || typeof c.name !== "string" || typeof c.value !== "string") continue;
    const cookie: NormalizedCookie = { name: c.name, value: c.value };

    if (typeof c.domain === "string") {
      // hostOnly cookies must not carry a leading dot.
      cookie.domain = c.hostOnly === true ? c.domain.replace(/^./, "") : c.domain;
    }
    if (typeof c.path === "string") cookie.path = c.path;
    if (typeof c.httpOnly === "boolean") cookie.httpOnly = c.httpOnly;
    if (typeof c.secure === "boolean") cookie.secure = c.secure;

    // expirationDate (float seconds) -> expires; omit for session cookies.
    if (c.session !== true && typeof c.expirationDate === "number") {
      cookie.expires = Math.floor(c.expirationDate);
    } else if (typeof c.expires === "number") {
      cookie.expires = Math.floor(c.expires);
    }

    // sameSite normalization.
    const ss = typeof c.sameSite === "string" ? c.sameSite.toLowerCase() : "";
    if (ss === "strict") cookie.sameSite = "Strict";
    else if (ss === "lax") cookie.sameSite = "Lax";
    else if (ss === "none" || ss === "no_restriction") cookie.sameSite = "None";
    // "unspecified"/missing -> leave undefined
    if (cookie.sameSite === "None") cookie.secure = true; // None requires Secure

    out.push(cookie);
  }
  return out;
}

// Meta vision models require a one-time license acceptance per account.
// Send a single { prompt: "agree" } request, guarded by a KV flag so it only happens once.
const VISION_MODEL = "@cf/meta/llama-3.2-11b-vision-instruct";

async function ensureAgreed(env: Env): Promise<void> {
  try {
    if (await env.CACHE.get("ai:agreed")) return;
    await env.AI.run(VISION_MODEL, { prompt: "agree" });
    await env.CACHE.put("ai:agreed", "1", { expirationTtl: 60 * 60 * 24 * 365 });
  } catch (err) {
    console.error("Workers AI license agreement failed:", err);
  }
}

async function analyse(env: Env, png: Uint8Array, portal: PortalRow): Promise<{ text: string; by: string }> {
  const prompt =
    `You are a senior product designer writing one tight paragraph (3-4 sentences) of design analysis ` +
    `for a UI reference library. Describe the landing page of ${portal.name} by ${portal.company}: its layout, ` +
    `visual hierarchy, use of colour and typography, and how it guides the user to the primary action. ` +
    `Be specific and critical. Do not mention that this is a screenshot.`;
  await ensureAgreed(env);
  try {
    const res: any = await env.AI.run(VISION_MODEL, {
      prompt,
      image: [...png],
      max_tokens: 320,
    });
    const text = (res?.response ?? "").toString().trim();
    if (text.length > 20) return { text, by: "workers-ai" };
  } catch (err) {
    console.error(`vision analysis failed for ${portal.slug}:`, err);
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
