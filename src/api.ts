import { zipSync } from "fflate";
import type { Env, CaptureRow } from "./types";
import { listPortals, listWeeks, latestWeek, capturesForWeek, getPortal } from "./db";
import { hasCookieSecret, storeCapture } from "./capture";

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };
const CACHE_VERSION = "v2-no-character";

function json(data: unknown, status = 200, extra: Record<string, string> = {}) {
  return new Response(JSON.stringify(data), { status, headers: { ...JSON_HEADERS, ...extra } });
}

function requireUploadToken(request: Request, env: Env): Response | null {
  const auth = request.headers.get("authorization") ?? "";
  const token = auth.replace(/^Bearer\s+/i, "").trim();
  const expected = (env as unknown as Record<string, unknown>).UPLOAD_TOKEN;
  if (typeof expected !== "string" || !expected) return json({ error: "server missing UPLOAD_TOKEN secret" }, 500);
  if (token !== expected) return json({ error: "unauthorized" }, 401);
  return null;
}

function extFromType(type: string): string {
  if (type.includes("jpeg") || type.includes("jpg")) return "jpg";
  if (type.includes("webp")) return "webp";
  return "png";
}

/** Public image URL for a capture: R2 object when present, else the seeded sample asset. */
function imageUrl(row: CaptureRow): string {
  if (!row.r2_key) return `/samples/${row.slug}.svg`;
  // Version the URL by capture time so a fresh screenshot busts the browser's 24h image cache.
  const v = Date.parse(row.captured_at) || 0;
  return `/img/${row.r2_key}?v=${v}`;
}

/** Public URL for the mobile screenshot, or null when none has been captured. */
function imageMobileUrl(row: CaptureRow): string | null {
  if (!row.r2_key_mobile) return null;
  const v = Date.parse(row.captured_at) || 0;
  return `/img/${row.r2_key_mobile}?v=${v}`;
}

function shapeCapture(row: CaptureRow) {
  let palette: string[] = [];
  try { palette = JSON.parse(row.palette || "[]"); } catch { palette = []; }
  const mobile = imageMobileUrl(row);
  return {
    id: row.id, slug: row.slug, portal: row.portal, company: row.company,
    url: row.url, brand: row.brand, week: row.week,
    image: imageUrl(row), imageMobile: mobile, hasMobile: !!mobile,
    width: row.width, height: row.height,
    palette, analysis: row.analysis, analysisBy: row.analysis_by,
    status: row.status, sample: !row.r2_key, capturedAt: row.captured_at,
    signedIn: !!row.r2_key && row.r2_key.endsWith(".local.png"),
  };
}

/** Cache-through a JSON payload in KV for `ttl` seconds. */
async function cached<T>(env: Env, key: string, ttl: number, build: () => Promise<T>): Promise<T> {
  const scopedKey = `${CACHE_VERSION}:${key}`;
  const hit = await env.CACHE.get(scopedKey, "json");
  if (hit) return hit as T;
  const fresh = await build();
  await env.CACHE.put(scopedKey, JSON.stringify(fresh), { expirationTtl: ttl });
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
        env.DB.prepare(`SELECT COUNT(*) AS n FROM captures c JOIN portals p ON p.slug = c.slug WHERE c.status='ok' AND p.active=1`).first<{ n: number }>(),
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


  // Manual snapshots uploaded from the UI: latest 6 per portal.
  if (path === "/api/manual" && request.method === "GET") {
    const slug = url.searchParams.get("slug") || "";
    if (!slug) return json({ error: "slug required" }, 400);
    const portal = await getPortal(env, slug);
    if (!portal) return json({ error: "unknown slug: " + slug }, 404);
    const rows = await env.DB.prepare(
      `SELECT id, slug, portal, device, description, r2_key, images, created_at
       FROM manual_shots WHERE slug=? ORDER BY created_at DESC LIMIT 60`
    ).bind(slug).all<{ id: string; slug: string; portal: string; device: string; description: string; r2_key: string; images: string | null; created_at: string }>();
    return json({
      slug,
      portal: portal.name,
      shots: (rows.results || []).map((r) => {
        const v = Date.parse(r.created_at) || 0;
        let keys: string[] = [];
        if (r.images) { try { const p = JSON.parse(r.images); if (Array.isArray(p)) keys = p.filter((k) => typeof k === "string"); } catch { /* ignore */ } }
        if (!keys.length && r.r2_key) keys = [r.r2_key];
        const images = keys.map((k) => `/img/${k}?v=${v}`);
        return {
          id: r.id,
          slug: r.slug,
          portal: r.portal,
          device: r.device,
          description: r.description || "",
          image: images[0] || "",
          images,
          imageKeys: keys,
          createdAt: r.created_at,
        };
      }),
    });
  }

  // Admin upload for one-off observations (token-gated, form-data).
  if (path === "/api/manual/upload" && request.method === "POST") {
    const authError = requireUploadToken(request, env);
    if (authError) return authError;

    const form = await request.formData();
    const slug = String(form.get("slug") || "");
    const device = String(form.get("device") || "desktop") === "mobile" ? "mobile" : "desktop";
    const description = String(form.get("description") || "").trim().slice(0, 220);
    const files = form.getAll("image").filter((f): f is File => f instanceof File);
    if (!slug || !files.length) return json({ error: "slug and image file required" }, 400);
    if (files.length > 5) return json({ error: "up to 5 images per card" }, 400);
    const portal = await getPortal(env, slug);
    if (!portal) return json({ error: "unknown slug: " + slug }, 400);

    const now = new Date().toISOString();
    const id = `${slug}-${Date.now()}-${crypto.randomUUID().slice(0, 8)}`;
    const keys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) return json({ error: "image file required" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 100) return json({ error: "image too small" }, 400);
      if (bytes.length > 12 * 1024 * 1024) return json({ error: "image too large (max 12MB)" }, 400);
      const r2Key = `manual/${slug}/${id}-${i}.${device}.${extFromType(file.type)}`;
      await env.SHOTS.put(r2Key, bytes, { httpMetadata: { contentType: file.type || "image/png" } });
      keys.push(r2Key);
    }
    await env.DB.prepare(
      `INSERT INTO manual_shots (id, slug, portal, device, description, r2_key, images, created_at) VALUES (?,?,?,?,?,?,?,?)`
    ).bind(id, slug, portal.name, device, description, keys[0], JSON.stringify(keys), now).run();
    const v = Date.parse(now);
    return json({ ok: true, id, slug, portal: portal.name, device, description, images: keys.map((k) => `/img/${k}?v=${v}`), createdAt: now });
  }

  // Admin edit of a manual snapshot (token-gated, form-data): description,
  // delete existing images (via the "keep" list), and/or add new images.
  if (path === "/api/manual/edit" && request.method === "POST") {
    const authError = requireUploadToken(request, env);
    if (authError) return authError;

    const form = await request.formData();
    const id = String(form.get("id") || "");
    if (!id) return json({ error: "id required" }, 400);
    const existing = await env.DB.prepare(
      `SELECT id, slug, device, r2_key, images FROM manual_shots WHERE id=?`
    ).bind(id).first<{ id: string; slug: string; device: string; r2_key: string; images: string | null }>();
    if (!existing) return json({ error: "unknown snapshot: " + id }, 404);

    const description = String(form.get("description") ?? "").trim().slice(0, 220);

    // Current keys for this snapshot.
    let currentKeys: string[] = [];
    if (existing.images) { try { const p = JSON.parse(existing.images); if (Array.isArray(p)) currentKeys = p.filter((k) => typeof k === "string"); } catch { /* ignore */ } }
    if (!currentKeys.length && existing.r2_key) currentKeys = [existing.r2_key];

    // Keys the client wants to keep (default: all current).
    let keep = currentKeys;
    const keepRaw = form.get("keep");
    if (typeof keepRaw === "string") {
      try { const p = JSON.parse(keepRaw); if (Array.isArray(p)) keep = currentKeys.filter((k) => p.includes(k)); } catch { /* ignore */ }
    }
    const removed = currentKeys.filter((k) => !keep.includes(k));

    // New images to add.
    const files = form.getAll("image").filter((f): f is File => f instanceof File);
    if (keep.length + files.length > 5) return json({ error: "up to 5 images per card" }, 400);
    if (keep.length + files.length < 1) return json({ error: "a card needs at least one image" }, 400);

    const addedKeys: string[] = [];
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      if (!file.type.startsWith("image/")) return json({ error: "image file required" }, 400);
      const bytes = new Uint8Array(await file.arrayBuffer());
      if (bytes.length < 100) return json({ error: "image too small" }, 400);
      if (bytes.length > 12 * 1024 * 1024) return json({ error: "image too large (max 12MB)" }, 400);
      const r2Key = `manual/${existing.slug}/${id}-add${Date.now()}-${i}.${existing.device}.${extFromType(file.type)}`;
      await env.SHOTS.put(r2Key, bytes, { httpMetadata: { contentType: file.type || "image/png" } });
      addedKeys.push(r2Key);
    }

    const nextKeys = [...keep, ...addedKeys];
    await env.DB.prepare(
      `UPDATE manual_shots SET description=?, r2_key=?, images=? WHERE id=?`
    ).bind(description, nextKeys[0], JSON.stringify(nextKeys), id).run();

    // Delete removed images from R2 (best-effort).
    for (const k of removed) { try { await env.SHOTS.delete(k); } catch { /* ignore */ } }

    const v = Date.now();
    return json({ ok: true, id, description, images: nextKeys.map((k) => `/img/${k}?v=${v}`) });
  }
  // Download every screenshot for a week as a single ZIP (the "download all" button).
  // ?device=mobile zips the mobile shots instead of desktop.
  if (path === "/api/collection.zip") {
    const requested = url.searchParams.get("week");
    const device = url.searchParams.get("device") === "mobile" ? "mobile" : "desktop";
    const week = requested ?? (await latestWeek(env));
    if (!week) return new Response("no captures yet", { status: 404 });
    const rows = await capturesForWeek(env, week);
    const keyOf = (r: CaptureRow) => (device === "mobile" ? r.r2_key_mobile : r.r2_key);
    const shots = rows.filter((r) => keyOf(r) && r.status === "ok");
    if (!shots.length) return new Response(`no ${device} screenshots for this week`, { status: 404 });

    // Fetch each screenshot from R2 in parallel.
    const files: Record<string, Uint8Array> = {};
    await Promise.all(
      shots.map(async (r) => {
        const obj = await env.SHOTS.get(keyOf(r) as string);
        if (obj) files[`${r.slug}.png`] = new Uint8Array(await obj.arrayBuffer());
      })
    );
    if (!Object.keys(files).length) return new Response("screenshots not found in storage", { status: 404 });

    // level 0 = store: PNGs are already compressed, so skip re-compression (fast, low CPU).
    const zipped = zipSync(files, { level: 0 });
    const body = zipped.slice().buffer;
    const suffix = device === "mobile" ? "-mobile" : "";
    return new Response(body, {
      headers: {
        "content-type": "application/zip",
        "content-disposition": `attachment; filename="ai-portals-${week}${suffix}.zip"`,
        "cache-control": "no-store",
      },
    });
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
    const authError = requireUploadToken(request, env);
    if (authError) return authError;

    const body = await request
      .json<{ slug?: string; week?: string; imageBase64?: string; variant?: string }>()
      .catch(() => ({} as { slug?: string; week?: string; imageBase64?: string; variant?: string }));
    if (!body.slug || !body.imageBase64) return json({ error: "slug and imageBase64 required" }, 400);

    const portal = await getPortal(env, body.slug);
    if (!portal) return json({ error: "unknown slug: " + body.slug }, 400);

    const variant = body.variant === "mobile" ? "mobile" : "desktop";
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

    await storeCapture(env, week, portal, png, "local", variant);
    return json({ ok: true, slug: body.slug, week, variant, bytes: png.length });
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
