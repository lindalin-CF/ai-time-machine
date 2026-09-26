import type { Env, CaptureRow } from "./types";
import { getPortal, listPortals, latestCaptureForPortal } from "./db";

const ORIGIN = "https://ai-portal-library.dev";
const HTML_HEADERS = { "content-type": "text/html; charset=utf-8" };

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function shotUrl(key: string | null, slug: string, capturedAt: string): string {
  if (!key) return `/samples/${slug}.svg`;
  return `/img/${key}?v=${Date.parse(capturedAt) || 0}`;
}

function shortText(s: string, max: number): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= max ? t : t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…";
}

function page(opts: { title: string; description: string; canonical?: string; noindex?: boolean; body: string }): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${esc(opts.title)}</title>
  <meta name="description" content="${esc(opts.description)}" />
${opts.noindex ? '  <meta name="robots" content="noindex" />\n' : ""}${opts.canonical ? `  <link rel="canonical" href="${esc(opts.canonical)}" />
  <meta property="og:type" content="website" />
  <meta property="og:site_name" content="AI Surface Library" />
  <meta property="og:title" content="${esc(opts.title)}" />
  <meta property="og:description" content="${esc(opts.description)}" />
  <meta property="og:url" content="${esc(opts.canonical)}" />
  <meta property="og:image" content="${ORIGIN}/og-image.png" />
` : ""}  <link rel="icon" href="/favicon.svg" type="image/svg+xml" />
  <style>
    body{margin:0;font:16px/1.6 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4efe8;color:#231f1a}
    .wrap{max-width:1000px;margin:0 auto;padding:24px 16px}
    a{color:inherit}
    header a{font-weight:600;text-decoration:none}
    h1{font-size:2rem;margin:24px 0 4px}
    .meta{color:#6b6257;margin:0 0 24px}
    .shots{display:flex;flex-wrap:wrap;gap:24px;align-items:flex-start}
    .shots figure{margin:0}
    .shots img{max-width:100%;height:auto;border:1px solid #d8cfc2;border-radius:8px;background:#fff}
    .desktop{flex:1 1 560px}.mobile{flex:0 1 240px}
    figcaption{font-size:.85rem;color:#6b6257;margin-top:6px}
    .analysis{white-space:pre-line;margin:32px 0}
    footer{border-top:1px solid #d8cfc2;margin-top:48px;padding-top:16px;font-size:.85rem;color:#6b6257}
  </style>
</head>
<body>
  <div class="wrap">
    <header><a href="/">&larr; AI Surface Library</a></header>
${opts.body}
    <footer>Independent personal project. Not affiliated with any of the companies featured.</footer>
  </div>
</body>
</html>`;
}

function notFound(): Response {
  const html = page({
    title: "Portal not found | AI Surface Library",
    description: "This portal page does not exist.",
    noindex: true,
    body: `    <main><h1>Portal not found</h1><p><a href="/">Browse the AI Surface Library</a></p></main>`,
  });
  return new Response(html, { status: 404, headers: HTML_HEADERS });
}

export async function handlePortalPage(request: Request, env: Env): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return new Response("method not allowed", { status: 405 });
  const url = new URL(request.url);
  let slug = "";
  try { slug = decodeURIComponent(url.pathname.replace(/^\/portals\//, "").replace(/\/$/, "")); } catch { return notFound(); }
  if (!/^[a-z0-9-]+$/.test(slug)) return notFound();

  const portal = await getPortal(env, slug);
  if (!portal || !portal.active) return notFound();
  const cap: CaptureRow | null = await latestCaptureForPortal(env, slug);

  const name = portal.name;
  const analysis = cap?.analysis?.trim() ?? "";
  const dateNote = cap ? ` Latest capture: week of ${cap.week}.` : "";
  const description = shortText(
    `${name} by ${portal.company}: screenshots of the logged-in interface, desktop and mobile, with design analysis.${dateNote} ${analysis}`,
    300
  );

  let shots = "";
  if (cap) {
    const desktop = shotUrl(cap.r2_key, slug, cap.captured_at);
    shots += `      <figure class="desktop"><img src="${esc(desktop)}" alt="${esc(`${name} desktop interface screenshot (${cap.week})`)}" width="${cap.width || 1280}" loading="eager" /><figcaption>Desktop &middot; week of ${esc(cap.week)}</figcaption></figure>\n`;
    if (cap.r2_key_mobile) {
      const mobile = shotUrl(cap.r2_key_mobile, slug, cap.captured_at);
      shots += `      <figure class="mobile"><img src="${esc(mobile)}" alt="${esc(`${name} mobile interface screenshot (${cap.week})`)}" loading="lazy" /><figcaption>Mobile &middot; week of ${esc(cap.week)}</figcaption></figure>\n`;
    }
  }

  const body = `    <main>
      <h1>${esc(name)}</h1>
      <p class="meta">${esc(portal.company)}${cap ? ` &middot; captured week of ${esc(cap.week)}` : ""}</p>
${cap ? `      <section class="shots" aria-label="${esc(name)} screenshots">\n${shots}      </section>
      <section class="analysis"><h2>Design analysis</h2><p>${esc(analysis || "No analysis available yet.")}</p></section>` : `      <p>No captures yet for ${esc(name)}.</p>`}
    </main>`;

  const html = page({
    title: `${name} — logged-in UI screenshots | AI Surface Library`,
    description,
    canonical: `${ORIGIN}/portals/${slug}`,
    body,
  });
  return new Response(request.method === "HEAD" ? null : html, {
    headers: { ...HTML_HEADERS, "cache-control": "public, max-age=300" },
  });
}

export async function handleSitemap(env: Env): Promise<Response> {
  const portals = await listPortals(env);
  const urls = [`${ORIGIN}/`, ...portals.map((p) => `${ORIGIN}/portals/${p.slug}`)];
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((u) => `  <url>\n    <loc>${esc(u)}</loc>\n  </url>`).join("\n")}
</urlset>
`;
  return new Response(xml, { headers: { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" } });
}
