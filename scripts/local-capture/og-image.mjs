// Renders the 1200x630 link-preview image (public/og-image-v2.png) from the homepage's dark sand hero.
//
//   node og-image.mjs <output.png> [homepage URL] [screenshots,portals,weeks]
//
// The page is rendered with prefers-reduced-motion: reduce, so the sand canvas draws its fixed still frame, the title
// and words are shown in place, and neither the keyword annotations nor the camera-focus reticle appear. The hero
// frame (1144px wide on any wide screen) is cropped with the cream page around it at the 1200:630 shape and scaled to
// 1200 wide, so the frame fills the same 1013px of the image the old layout gave it (a 1056px placed image, 24px of page
// each side) with no seam between the page and a flat canvas. The page is 1440px wide to have room for that margin. The stats and the latest week are the live site's (https://ai-portal-library.dev/api/stats and
// /api/weeks); the stats fall back to the argument (default: the original image's numbers) when the site can't be
// reached. Never write straight over an existing file.
import fs from "node:fs";
import puppeteer from "puppeteer";

const [out, url = "http://localhost:8787/", statsArg = "64,15,4"] = process.argv.slice(2);
if (!out) { console.error("usage: node og-image.mjs <output.png> [homepage URL] [screenshots,portals,weeks]"); process.exit(1); }
if (fs.existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(1); }

const LIVE = "https://ai-portal-library.dev";
const live = async (path) => {
  try {
    const r = await fetch(LIVE + path, { headers: { accept: "application/json" }, signal: AbortSignal.timeout(10_000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
};
const [liveStats, liveWeeks] = await Promise.all([live("/api/stats"), live("/api/weeks")]);
const [screenshots, portals, weeks] = liveStats ? [liveStats.screenshots, liveStats.portals, liveStats.weeks].map(String) : statsArg.split(",");
const weekLabel = liveWeeks?.weeks?.[0]?.label ?? null;
console.log(`stats ${screenshots}, ${portals}, ${weeks} (${liveStats ? "live" : "argument"}); week: ${weekLabel ?? "as the page renders it"}`);

// Software rendering, so the canvas still frame and the film grain come out the same on every machine.
const browser = await puppeteer.launch({ args: ["--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
  await page.setViewport({ width: 1440, height: 1200 }); // tall enough for the hero's 500px panel (its height follows the viewport below 900px)
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.waitForFunction(() => document.querySelector(".hero-panel")?.dataset.sand === "still");
  const frame = await page.evaluate(async ({ screenshots, portals, weeks, weekLabel }) => {
    await document.fonts.ready;
    const set = (k, v) => { document.querySelector(`[data-stat="${k}"]`).textContent = v; };
    set("screenshots", screenshots); set("portals", portals); set("weeks", weeks);
    const m = weekLabel && /^Week of (.+), (\d{4})$/.exec(weekLabel);
    if (m) {
      const el = document.querySelector("#heroWeek");
      el.textContent = "Week of ";
      el.append(Object.assign(document.createElement("b"), { textContent: m[1] }), `, ${m[2]}`);
    }
    // The crop reaches above and below the hero: hide the top bar and what follows the hero, without moving anything.
    for (const el of document.querySelectorAll(".topbar, #galleryView > :not(.hero)")) el.style.visibility = "hidden";
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // one extra frame after the edits
    const r = document.querySelector(".hero-frame").getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY, width: r.width, height: r.height };
  }, { screenshots, portals, weeks, weekLabel });

  // Scaled by 1056/1192 (the old placed image over its crop), the frame keeps its size in the image; the crop is the
  // whole 1200x630 at that scale, centred on the frame.
  const scale = 1056 / 1192, cropW = Math.round(1200 / scale), cropH = Math.round(630 / scale);
  const clip = { x: frame.x - (cropW - frame.width) / 2, y: frame.y - (cropH - frame.height) / 2, width: cropW, height: cropH };
  const crop = await page.screenshot({ clip, encoding: "base64" });

  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#e7dfd4">
    <img src="data:image/png;base64,${crop}" style="position:absolute;left:0;top:0;width:1200px;height:630px" />
  </body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
