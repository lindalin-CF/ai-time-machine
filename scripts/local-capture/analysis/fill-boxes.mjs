/**
 * Solid-colour fills for redacting screenshots, shared by analysis/redact.mjs and the fill step in
 * .claude/commands/redact-week.md so both behave the same. Mutates a pngjs PNG in place; writing the
 * file (and refusing to overwrite) is up to the caller.
 *
 * A box is [x, y, w, h, "#RRGGBB"] (rectangle) or [x, y, w, h, "#RRGGBB", "circle"]. A circle fills only
 * the ellipse inscribed in the box: a pixel is filled when its centre lies inside it, and every pixel
 * outside is left as it was. Boxes are in image pixels and are clamped to the image.
 */

export const SHAPES = ["rect", "circle"];

export function parseHex(h) {
  const m = /^#?([0-9a-f]{6})$/i.exec(h);
  if (!m) throw new Error(`colour must be #RRGGBB (got "${h}")`);
  return [0, 2, 4].map((i) => parseInt(m[1].slice(i, i + 2), 16));
}

/** Fills each box and returns the clamped boxes that were filled, as { x, y, w, h, fill, shape }. */
export function fillBoxes(png, boxes) {
  return boxes.map((box) => {
    const [x, y, w, h, fill, shape = "rect"] = box;
    if (![x, y, w, h].every((n) => Number.isInteger(n) && n >= 0)) throw new Error(`box needs non-negative integer x,y,w,h: ${JSON.stringify(box)}`);
    if (!w || !h) throw new Error(`box has zero size: ${JSON.stringify(box)}`);
    if (!SHAPES.includes(shape)) throw new Error(`shape must be one of ${SHAPES.join(", ")} (got "${shape}")`);
    if (x >= png.width || y >= png.height) throw new Error(`box ${x},${y},${w},${h} is outside the ${png.width}x${png.height} image`);
    const [r, g, b] = parseHex(fill);
    // The ellipse is defined on the requested box, so clamping at the image edge never reshapes it.
    const cx = x + w / 2, cy = y + h / 2, rx = w / 2, ry = h / 2;
    const x1 = Math.min(png.width, x + w), y1 = Math.min(png.height, y + h);
    for (let py = y; py < y1; py++) {
      for (let px = x; px < x1; px++) {
        if (shape === "circle") {
          const dx = (px + 0.5 - cx) / rx, dy = (py + 0.5 - cy) / ry;
          if (dx * dx + dy * dy > 1) continue;
        }
        const i = (py * png.width + px) * 4;
        png.data[i] = r; png.data[i + 1] = g; png.data[i + 2] = b; png.data[i + 3] = 255;
      }
    }
    return { x, y, w: x1 - x, h: y1 - y, fill: `#${fill.replace(/^#/, "").toUpperCase()}`, shape };
  });
}
