// A hero timeline strip as the Worker renders it (src/wireframe.ts timelineHtml), for the browser tests: six weeks of
// a made-up product whose message box moves up from the fourth week (y 400 -> 300) and whose sidebar narrows in the last.
import { timelineHtml, type HeroTimeline, type Wireframe } from '../../src/wireframe';

const frame = (inputY: number, sidebarW: number, cards: number): Wireframe => ({
  sidebar: [0, 0, sidebarW, 800], topbar: null, heading: [500, inputY - 70, 280, 30],
  input: [400, inputY, 640, 60], cards: Array.from({ length: cards }, (_, i) => [420 + i * 200, inputY + 90, 180, 60] as [number, number, number, number]),
});
const WEEKS = ['2026-10-12', '2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09', '2026-11-16'];
const LABELS = ['Week of Oct 12, 2026', 'Week of Oct 19, 2026', 'Week of Oct 26, 2026', 'Week of Nov 2, 2026', 'Week of Nov 9, 2026', 'Week of Nov 16, 2026'];
export const TIMELINE_DATA: HeroTimeline = {
  slug: 'chatgpt', name: 'ChatGPT',
  frames: WEEKS.map((week, i) => ({ week, n: 10 + i, label: LABELS[i], boxes: frame(i < 3 ? 400 : 300, i < 5 ? 260 : 200, i < 2 ? 0 : 2) })),
};
export const TIMELINE = timelineHtml(TIMELINE_DATA);
