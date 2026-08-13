import type { Env, CaptureRow } from "./types";
import { listPortals, listWeeks, latestWeek, capturesForWeek, getPortal } from "./db";
import { hasCookieSecret, storeCapture } from "./capture";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

/** Public image URL for a capture: R2 object when present, else the seeded sample asset. */
function imageUrl(row: CaptureRow): string {
  if (!row.r2_key) return `/samples/${row.slug}.svg`;
  // Version the URL by capture time so a fresh screenshot busts the browser's 24h image cache.
  const v = Date.parse(row.captured_at) || 0;
  return `/img/${row.r2_key}?v=${v}`;
}

function shapeCapture(row: CaptureRow) {
  let palette: string[] = [];
  try { palette = JSON.parse(row.palette || "[]"); } catch { palette = []; }
  return {
    id: row.id, slug: row.slug, portal: row.portal, company: row.company,
    url: row.url, brand: row.brand, week: row.week,
    image: imageUrl(row), width: row.width, height: row.height,
    palette, analysis: row.analysis, analysisBy: row.analysis_by,
    status: row.status, sample: !row.r2_key, capturedAt: row.captured_at,
    signedIn: !!row.r2_key && row.r2_key.endsWith(".local.png"),
  };
}

/** Cache-through a JSON payload in KV for `ttl` seconds. */
async function cached<T>(env: Env, key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const hit = await env.CACHE.get(key, "json");
  if (hit) return hit as T;
  const fresh = await build();
  await env.CACHE.put(key, JSON.stringify(fresh), { expirationTtl: ttl });
  return fresh;
}

export async function handleApi(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
  const url = new URL(request.url);
  const path = url.pathname;

  if (path === "/api/health") return json({ ok: true, ts: Date.now() });

  if (path === "/api/portals") {
    const data = await cached(env, "cache:portals", 300, async () => {
      const ps = await listPortals(env);
      return ps.map((p) => ({ slug: p.slug, name: p.name, company: p.company, url: p.url, brand: p.brand }));
    });
    return json({ portals: data });
  }

  if (path === "/api/weeks") {
    const data = await cached(env, "cache:weeks", 300, async () => await listWeeks(env));
    return json({ weeks: data });
  }

  if (path === "/api/stats") {
    const data = await cached(env, "cache:stats", 300, async () => {
      const [shots, portals, weeks] = await Promise.all([
        env.DB.prepare(`SELECT COUNT(*) AS n FROM captures WHERE status='ok'`).first<{ n: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM portals WHERE active=1`).first<{ n: number }>(),
        env.DB.prepare(`SELECT COUNT(*) AS n FROM weeks`).first<{ n: number }>(),
      ]);
      return { screenshots: shots?.n ?? 0, portals: portals?.n ?? 0, weeks: weeks?.n ?? 0 };
    });
    return json(data);
  }

  if (path === "/api/captures") {
    const requested = url.searchParams.get("week");
    const week = requested ?? (await latestWeek(env));
    if (!week) return json({ week: null, label: null, captures: [] });
    const payload = await cached(env, `cache:captures:${week}`, 300, async () => {
      const rows = await capturesForWeek(env, week);
      const weeks = await listWeeks(env);
      const label = weeks.find((w) => w.week === week)?.label ?? week;
      return { week, label, captures: rows.map(shapeCapture) };
    });
    return json(payload);
  }

  // Admin: one-time Meta license acceptance for the vision model.
  if (path === "/api/ai/agree" && request.method === "POST") {
    try {
      const r = await env.AI.run("@cf/meta/llama-3.2-11b-vision-instruct", { prompt: "agree" });
      await env.CACHE.put("ai:agreed", "1", { expirationTtl: 60 * 60 * 24 * 365 });
      return json({ agreed: true, result: r });
    } catch (e) {
      return json({ agreed: false, error: String(e) }, 500);
    }
  }

  // Admin: re-run capture for specific portal(s) only (e.g. ones that failed).
  // Local upload: a screenshot taken on YOUR machine (real login, residential IP) is stored
  // through the same R2 -> Workers AI -> D1 pipeline as cloud captures. Token-gated.
  if (path === "/api/upload" && request.method === "POST") {
    const auth = request.headers.get("authorization") ?? "";
    const token = auth.replace(/^Bearer\s+/i, "").trim();
    const expected = (env as unknown as Record<string, unknown>).UPLOAD_TOKEN;
    if (typeof expected !== "string" || !expected) {
      return json({ error: "server missing UPLOAD_TOKEN secret" }, 500);
    }
    if (token !== expected) return json({ error: "unauthorized" }, 401);

    const body = await request
      .json<{ slug?: string; week?: string; imageBase64?: string }>()
      .catch(() => ({} as { slug?: string; week?: string; imageBase64?: string }));
    if (!body.slug || !body.imageBase64) return json({ error: "slug and imageBase64 required" }, 400);

    const portal = await getPortal(env, body.slug);
    if (!portal) return json({ error: "unknown slug: " + body.slug }, 400);

    const week = body.week ?? isoMonday(new Date());
    const b64 = body.imageBase64.replace(/^data:image\/png;base64,/, "");
    let png: Uint8Array;
    try {
      const bin = atob(b64);
      png = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) png[i] = bin.charCodeAt(i);
    } catch {
      return json({ error: "invalid base64 image" }, 400);
    }
    if (png.length < 100) return json({ error: "image too small" }, 400);

    await storeCapture(env, week, portal, png, "local");
    return json({ ok: true, slug: body.slug, week, bytes: png.length });
  }

  // Which portals have a COOKIES_<SLUG> secret configured (booleans only; never leaks values).
  if (path === "/api/auth/status") {
    const portals = await listPortals(env);
    return json({
      portals: portals.map((p) => ({ slug: p.slug, name: p.name, hasCookies: hasCookieSecret(env, p.slug) })),
    });
  }

  if (path === "/api/capture/portal" && request.method === "POST") {
    const body = await request
      .json<{ week?: string; slug?: string; slugs?: string[] }>()
      .catch(() => ({} as { week?: string; slug?: string; slugs?: string[] }));
    const week = body.week ?? isoMonday(new Date());
    const requested = body.slugs ?? (body.slug ? [body.slug] : []);
    if (!requested.length) return json({ error: "provide slug or slugs[]" }, 400);
    const portals = await listPortals(env);
    const valid = new Set(portals.map((p) => p.slug));
    const slugs = requested.filter((s) => valid.has(s));
    const unknown = requested.filter((s) => !valid.has(s));
    if (!slugs.length) return json({ error: "no valid slugs", unknown }, 400);
    // Reuse the Queue consumer -> Browser Rendering + R2 + Workers AI + D1 + retries.
    await env.CAPTURE_QUEUE.sendBatch(slugs.map((slug) => ({ body: { week, slug } })));
    return json({ enqueued: true, week, slugs, unknown });
  }

  // Admin: manually trigger a capture run for the current (or supplied) week.
  if (path === "/api/capture/run" && request.method === "POST") {
    const body = await request
      .json<{ week?: string; label?: string }>()
      .catch(() => ({} as { week?: string; label?: string }));
    const week = body.week ?? isoMonday(new Date());
    const label = body.label ?? weekLabel(week);
    const instance = await env.CAPTURE_WORKFLOW.create({ params: { week, label } });
    return json({ started: true, week, label, instanceId: instance.id });
  }

  return json({ error: "not_found" }, 404);
}

/** Stream a screenshot straight out of R2. */
export async function handleImage(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const key = decodeURIComponent(url.pathname.replace(/^\/img\//, ""));
  if (!key) return new Response("missing key", { status: 400 });
  const obj = await env.SHOTS.get(key);
  if (!obj) return new Response("not found", { status: 404 });
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  headers.set("cache-control", "public, max-age=86400");
  return new Response(obj.body, { headers });
}

// ---------- date helpers ----------
export function isoMonday(d: Date): string {
  const date = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = date.getUTCDay(); // 0 Sun .. 6 Sat
  const diff = (day === 0 ? -6 : 1) - day; // shift to Monday
  date.setUTCDate(date.getUTCDate() + diff);
  return date.toISOString().slice(0, 10);
}
export function weekLabel(iso: string): string {
  const d = new Date(iso + "T00:00:00Z");
  const m = d.toLocaleString("en-US", { month: "short", timeZone: "UTC" });
  return `Week of ${m} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}
