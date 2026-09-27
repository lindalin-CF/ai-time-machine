// Renders the 1200x630 link-preview image (public/og-image.png) from the homepage hero.
//
//   node og-image.mjs <output.png> [homepage URL] [screenshots,portals,weeks]
//
// Layout matches the original image: a 1207x640 crop around the hero at a 1280px
// viewport, scaled to 1056x560 and centred on a #e7dfd4 canvas. The stats default
// to the numbers in the original image. Never write straight over an existing file.
import fs from "node:fs";
import puppeteer from "puppeteer";

const [out, url = "http://localhost:8787/", statsArg = "64,15,4"] = process.argv.slice(2);
if (!out) { console.error("usage: node og-image.mjs <output.png> [homepage URL] [screenshots,portals,weeks]"); process.exit(1); }
if (fs.existsSync(out)) { console.error(`refusing to overwrite ${out}`); process.exit(1); }
const [screenshots, portals, weeks] = statsArg.split(",");

// Headless GPU rendering washes out the hero's 1px grid lines; software rendering draws them correctly.
const browser = await puppeteer.launch({ args: ["--disable-gpu"] });
try {
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 1200 }); // tall enough that the crop never resizes (resize resets the orb)
  await page.goto(url, { waitUntil: "networkidle0" });
  await page.evaluate(() => document.fonts.ready);
  await new Promise((r) => setTimeout(r, 2000)); // let the stats count-up and title rise finish
  const frame = await page.evaluate(({ screenshots, portals, weeks }) => {
    const set = (k, v) => { document.querySelector(`[data-stat="${k}"]`).textContent = v; };
    set("screenshots", screenshots); set("portals", portals); set("weeks", weeks);
    // Finish the title animation and pin the cursor-driven orb where the original image has it.
    for (const el of document.querySelectorAll(".title-line")) { el.style.animation = "none"; el.style.transform = "none"; }
    const style = document.createElement("style");
    style.textContent = ".hero-orb{left:calc(25% + 10px)!important;top:393px!important}";
    document.head.append(style);
    const r = document.querySelector(".hero-frame").getBoundingClientRect();
    return { x: r.left + window.scrollX, y: r.top + window.scrollY };
  }, { screenshots, portals, weeks });
  const crop = await page.screenshot({ clip: { x: frame.x - 24, y: frame.y - 41, width: 1207, height: 640 }, encoding: "base64" });

  await page.setViewport({ width: 1200, height: 630 });
  await page.setContent(`<!doctype html><html><body style="margin:0;width:1200px;height:630px;background:#e7dfd4">
    <img src="data:image/png;base64,${crop}" style="position:absolute;left:72px;top:35px;width:1056px;height:560px" />
  </body></html>`, { waitUntil: "load" });
  await page.screenshot({ path: out, clip: { x: 0, y: 0, width: 1200, height: 630 } });
  console.log(`wrote ${out}`);
} finally {
  await browser.close();
}
