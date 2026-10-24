/** One /changelog entry. `date` and `time` are local time at CHANGELOG_UTC_OFFSET; `time` is left out when there is no single commit to date it by. */
export type ChangelogEntry = {
  slug: string;
  date: string; // YYYY-MM-DD
  time?: string; // HH:MM, 24-hour
  title: string;
  subtitle: string;
  bullets: { lead: string; text: string }[];
  closing: string;
};

/** The UTC offset every entry's date and time is written in (the offset of the commits they come from). */
export const CHANGELOG_UTC_OFFSET = "-05:00";

/** Decisions and releases, newest first. Each time is the first commit of that change (`git log --date=iso`). */
export const CHANGELOG: ChangelogEntry[] = [
  {
    slug: "model-picker-not-a-menu-change",
    date: "2026-10-23",
    time: "21:00",
    title: "The Model Picker Is One Menu Item",
    subtitle: "The model name in a portal's message box no longer counts as a menu change",
    bullets: [
      { lead: "Session, not design", text: "Names like Opus 5.5 High, Gemini Auto or Fast only show the model picked in that visit, so every page now lists them as one item: a model picker." },
      { lead: "Fewer false changes", text: "Compare, the How the UI changed timeline and /changes no longer report a new model name as a renamed menu item. A picker that appears or disappears still counts." },
      { lead: "Past weeks too", text: "Applied when pages are shown, so earlier weeks are corrected without editing any published analysis." },
    ],
    closing: "Compare Claude's weeks of Oct 19 and Oct 12 in Table view.",
  },
  {
    slug: "compare-button-opens-table",
    date: "2026-10-21",
    time: "18:27",
    title: "Compare → Opens the Table",
    subtitle: "The Compare → button on the Library page now always opens Compare in Table view",
    bullets: [
      { lead: "Table first", text: "On Desktop and Mobile alike, with the portals, week and device you picked. Canvas is one click away." },
    ],
    closing: "Pick two portals on the Library page, then press Compare →.",
  },
  {
    slug: "compare-device-icons",
    date: "2026-10-21",
    time: "18:19",
    title: "Desktop and Mobile Icons in Compare",
    subtitle: "Compare's Desktop | Mobile switch now has the monitor and phone icons, like the Library",
    bullets: [
      { lead: "One switch", text: "The Library, the Collection and Compare now share the same Desktop | Mobile switch." },
      { lead: "Same place", text: "In Compare it is still exactly as wide as Across portals | Single portal, and Mobile is still off in Canvas, which compares desktop screenshots only." },
    ],
    closing: "Open Compare and look at Desktop | Mobile.",
  },
  {
    slug: "library-week-dropdown",
    date: "2026-10-21",
    time: "18:02",
    title: "One Week Dropdown",
    subtitle: "The week picker in the Library filter bar is now the same dropdown Compare uses",
    bullets: [
      { lead: "Same look", text: "Same button, chevron, menu and focus ring on both pages, as tall as Desktop | Mobile next to it." },
      { lead: "Same keys", text: "Arrows move through the weeks, Enter picks one, Esc closes, and a click outside closes it too." },
    ],
    closing: "Open the week menu on the Library page.",
  },
  {
    slug: "filter-bar-compare-button",
    date: "2026-10-21",
    time: "17:50",
    title: "Compare From the Filter Bar",
    subtitle: "On the Library page, Compare → now sits at the end of the filter bar, replacing the Browse | Compare switch",
    bullets: [
      { lead: "Compare →", text: "Opens Compare with the bar's week and device. Two to four portals go side by side (the first four if you picked more), one portal is shown this week against the week before, and All portals uses Compare's defaults." },
      { lead: "Canvas or Table", text: "Desktop opens the Canvas. Mobile opens the Table." },
      { lead: "Slimmer bar", text: "The \"Filter by portal\" label is gone. Search starts a little wider and grows when you click into it, and on phones Compare → spans the bar at the bottom." },
    ],
    closing: "Pick two portals on the Library page, then press Compare →.",
  },
  {
    slug: "compare-toggles-aligned",
    date: "2026-10-21",
    time: "17:26",
    title: "Matching Compare Switches",
    subtitle: "In Compare, Desktop | Mobile is now exactly as wide as Across portals | Single portal above it",
    bullets: [
      { lead: "Lined up", text: "The two switches share their left and right edges, each with two equal halves. The week sits to the right of Desktop | Mobile, and the selected count stays at the far right." },
      { lead: "On phones", text: "Both switches are full width, with the week below them." },
    ],
    closing: "Open Compare and look at the two switches.",
  },
  {
    slug: "compare-all-portals-row",
    date: "2026-10-21",
    time: "17:18",
    title: "Every Portal in One Row",
    subtitle: "Compare's portal row now shows every portal, with no + more menu",
    bullets: [
      { lead: "Scroll sideways", text: "Swipe, use the mouse wheel, or Tab through the chips. The edges fade where there are more portals to see." },
      { lead: "Your picks in view", text: "When Compare opens, including from a shared link, the row scrolls to the first portal you picked." },
      { lead: "Same rules", text: "Pick up to four portals to compare. The count and Clear work as before." },
    ],
    closing: "Open Compare and scroll the portal row.",
  },
  {
    slug: "compare-portal-row",
    date: "2026-10-21",
    time: "17:06",
    title: "Compare's Portals on One Line",
    subtitle: "Compare now lists portals the way the Library filter bar does",
    bullets: [
      { lead: "One row", text: "The first four portals sit in one row that scrolls sideways, so the comparison starts higher on the page." },
      { lead: "+ more", text: "The rest are in a \"+ more\" menu. A portal you pick there joins the row, and picking it again takes it out." },
      { lead: "Same limits", text: "Across portals still compares up to four portals, and Single portal still follows one." },
    ],
    closing: "Open Compare and pick a portal from + more.",
  },
  {
    slug: "browse-compare-filter-bar",
    date: "2026-10-21",
    time: "16:42",
    title: "Browse or Compare, and One Filter Bar",
    subtitle: "On the Library page, browsing and comparing are now two separate choices, and the filters sit in one slim bar that stays in view",
    bullets: [
      { lead: "Browse | Compare", text: "A switch above the filters. Compare opens the Compare page in Table view, with your week, device and the portals you picked." },
      { lead: "One bar", text: "Portal chips, Desktop | Mobile, the week and search now share one row. It stays pinned under the top bar as you scroll." },
      { lead: "+ more", text: "The first four portals show as chips. The rest are in a \"+ more\" menu, and the ones you pick join the row." },
      { lead: "Compare what you picked", text: "Pick several portals and Compare puts them side by side (up to four). All portals shows everything again." },
    ],
    closing: "Pick a portal on the Library page, then press Compare.",
  },
  {
    slug: "canvas-movable-findings",
    date: "2026-10-19",
    time: "21:36",
    title: "Movable Findings Boxes",
    subtitle: "On the Compare canvas, the findings box between two cards can now be dragged out of the way",
    bullets: [
      { lead: "Drag it", text: "Press on a findings box and drag it anywhere. A click still selects its line, and × still removes it." },
      { lead: "It follows the line", text: "When you move a card, the box moves with its line and keeps the spot you gave it." },
      { lead: "Saved and shared", text: "Moved boxes are kept with the rest of your layout and in Copy link links. Reset puts them back in the middle of their lines." },
    ],
    closing: "Open Compare in Canvas and drag a findings box.",
  },
  {
    slug: "compare-device-first",
    date: "2026-10-19",
    time: "21:19",
    title: "Device First, One Even Row",
    subtitle: "In Compare, Desktop | Mobile now comes before the week, and the controls share one size",
    bullets: [
      { lead: "New order", text: "The second row reads Desktop | Mobile, then the week (or weeks), with the selected count at the right end." },
      { lead: "One size", text: "Desktop | Mobile and the week menu are the same height, text size and roundness as Across portals | Single portal above them, and both rows still start and end on the same edges." },
    ],
    closing: "Open Compare and switch between Desktop and Mobile.",
  },
  {
    slug: "compare-mode-names",
    date: "2026-10-19",
    time: "20:47",
    title: "Clearer Compare Mode Names",
    subtitle: "The two Compare modes are now Across portals and Single portal",
    bullets: [
      { lead: "New names", text: "Across products is now Across portals, and Week by week is now Single portal, which says what each mode compares." },
      { lead: "Same links", text: "Shared Compare links open exactly as before." },
    ],
    closing: "Open Compare and pick Single portal to follow one portal over the weeks.",
  },
  {
    slug: "selected-looks-the-same",
    date: "2026-10-19",
    time: "20:30",
    title: "One Look for Selected",
    subtitle: "Every switch now marks its chosen option the way the product buttons do",
    bullets: [
      { lead: "Dark fill", text: "The chosen side of Across products | Week by week, Desktop | Mobile and Table | Canvas has the same dark fill and light text as a selected product, so it is clear which one is on." },
      { lead: "Unchanged", text: "Options that are not chosen look as before, Mobile still looks unavailable in Canvas, and the top bar still marks the page you are on in orange." },
    ],
    closing: "Open Compare and switch between Table and Canvas.",
  },
  {
    slug: "changelog-in-footer",
    date: "2026-10-19",
    time: "20:18",
    title: "Changelog Moves to the Footer",
    subtitle: "The top bar keeps the three places you browse: Library, Collection and Compare",
    bullets: [
      { lead: "Top bar", text: "Library, Collection and Compare, on every page and in the phone menu." },
      { lead: "Footer", text: "The Changelog link stays after License, where it was. Old #notes links still open this page." },
    ],
    closing: "Scroll to the bottom of any page to find the Changelog.",
  },
  {
    slug: "compare-mode-row",
    date: "2026-10-19",
    time: "20:00",
    title: "Compare Mode on Its Own Row",
    subtitle: "The switch between Across products and Week by week now sits first in the Compare controls",
    bullets: [
      { lead: "First row", text: "Across products | Week by week has a row to itself, as wide as the week menu and the Desktop/Mobile switch below it, so it is easier to spot." },
      { lead: "Second row", text: "The week menu (or the weeks picker in Week by week), Desktop/Mobile, and the selected count with Clear on the right. The product buttons follow." },
      { lead: "Phones", text: "The same rows at full width." },
    ],
    closing: "Open Compare and pick a mode in the first row.",
  },
  {
    slug: "design-polish",
    date: "2026-10-19",
    time: "19:43",
    title: "Design Polish",
    subtitle: "Small fixes across the site, most of them for phones",
    bullets: [
      { lead: "Compare on phones", text: "The Table shows one card per product or week, with the differences and similarities between the cards. The product buttons sit in one row that scrolls sideways, so the results start on the first screen." },
      { lead: "Shorter comparisons", text: "Under a heading such as \"Oct 12, 2026 vs Oct 5, 2026\", findings no longer repeat both dates, for example \"The newer week shows no suggested prompts; the older shows 3.\" The Canvas boxes keep the full names." },
      { lead: "Canvas", text: "The board opens with the cards near its top instead of below empty space." },
      { lead: "Chat button", text: "On phones it is a little smaller and the page leaves room below it, so it no longer covers the last content." },
      { lead: "Buttons and text", text: "Buttons shrink slightly while pressed (not with reduced motion), every control shows an orange ring on keyboard focus, small labels are easier to read, and the disabled Mobile option in Canvas stays readable and says why on hover." },
      { lead: "Every page", text: "Product pages, this Changelog and the other pages use the homepage's fonts, and the cookie banner uses the site's colours." },
    ],
    closing: "Open Compare on a phone and switch to Table.",
  },
  {
    slug: "phone-menu",
    date: "2026-10-18",
    time: "20:12",
    title: "Menu Button on Phones",
    subtitle: "On small screens the top bar keeps Library, Collection, Compare and Changelog behind one button",
    bullets: [
      { lead: "One tap", text: "The menu button at the top right opens the four pages as a list with larger tap targets. The current page is marked in orange." },
      { lead: "Closing", text: "Choosing a page, tapping outside the list or pressing Esc closes it." },
      { lead: "Wider screens", text: "On tablets and computers the links stay in the top bar as before." },
    ],
    closing: "Open the site on a phone and tap the menu button at the top right.",
  },
  {
    slug: "card-details-link",
    date: "2026-10-18",
    time: "19:48",
    title: "Details Button on Every Card",
    subtitle: "A clear way from a Library card to its product page",
    bullets: [
      { lead: "Details →", text: "Each card ends with a Details button that opens the product's page for that week, the same page as the product name." },
      { lead: "Next to …", text: "It sits just right of the … button, which still opens that product's manual snapshots." },
    ],
    closing: "Click Details → at the bottom right of any card in the Library.",
  },
  {
    slug: "card-more-button",
    date: "2026-10-18",
    time: "19:39",
    title: "Clearer More Snapshots Button",
    subtitle: "The View more button on each card is now a small … button",
    bullets: [
      { lead: "Why", text: "Testers read \"View more\" as a link to the product's page. The new button only opens that product's manual snapshots." },
      { lead: "Same snapshots", text: "It opens the same Manual observations window, with the same snapshots and upload." },
    ],
    closing: "Click … at the bottom right of any card in the Library.",
  },
  {
    slug: "table-page-links",
    date: "2026-10-18",
    time: "17:27",
    title: "Open Product Pages From the Table",
    subtitle: "Each column in Compare's Table links to its product page",
    bullets: [
      { lead: "Page row", text: "Under Captured, a button such as \"Gemini · Oct 5, 2026\" opens that product's page for that week." },
      { lead: "Latest week", text: "The newest captured week opens the product's main page; older weeks open their own weekly page." },
    ],
    closing: "Open Compare, switch to Table and use the Page row.",
  },
  {
    slug: "notes-replaced-by-changelog",
    date: "2026-10-18",
    time: "17:27",
    title: "Notes Replaced by Changelog",
    subtitle: "The top bar now links to the Changelog",
    bullets: [
      { lead: "New tab", text: "The top bar reads Library, Collection, Compare and Changelog, on every page of the site." },
      { lead: "Old links", text: "Links to the Notes view open the Changelog." },
    ],
    closing: "Click Changelog in the top bar.",
  },
  {
    slug: "table-differences-similarities",
    date: "2026-10-18",
    time: "17:27",
    title: "Differences and Similarities in the Table",
    subtitle: "See at a glance what changed between columns",
    bullets: [
      { lead: "Two new rows", text: "Under the screenshots, Differences and Similarities list what differs and what matches, from the same measurements as the Canvas comparison box." },
      { lead: "Who is compared", text: "Week by week compares each week with the week before it; Across products compares each product with the first one." },
    ],
    closing: "Open Compare and switch to Table.",
  },
  {
    slug: "compare-from-portal-pages",
    date: "2026-10-18",
    time: "17:26",
    title: "Compare From Any Product Page",
    subtitle: "One click from a product to its last two weeks side by side",
    bullets: [
      { lead: "Compare button", text: "Each product page has a Compare button next to the capture date. It opens Compare in Week by week, with that product and two neighbouring weeks on the canvas." },
      { lead: "Which weeks", text: "A past week opens next to the week after it; the latest week opens next to the week before it." },
    ],
    closing: "Open any product page and click Compare.",
  },
  {
    slug: "analytics-is-now-compare",
    date: "2026-10-18",
    time: "13:51",
    title: "Analytics Is Now Compare",
    subtitle: "A clearer name for the page where you compare products",
    bullets: [
      { lead: "New name", text: "Analytics is now Compare, and its two modes are Across products and Week by week." },
      { lead: "Old links still work", text: "Links to #analytics, including shared setups, open Compare exactly as they were shared." },
    ],
    closing: "Open Compare from the top bar.",
  },
  {
    slug: "ui-change-timeline",
    date: "2026-10-17",
    time: "21:43",
    title: "How Each Product's UI Changed",
    subtitle: "Every product page now lists its menu changes, week by week",
    bullets: [
      { lead: "Change timeline", text: "Under the latest screenshots, each product page lists the weeks its menu changed, newest first, such as \"Scheduled renamed to Tasks\". Each week links to its own page." },
      { lead: "Other names", text: "Products known by more than one name show it under the title, for example \"Le Chat by Mistral AI · also called LeChat\"." },
      { lead: "Clearer titles", text: "Page titles, descriptions and image text now say plainly that these are UI screenshots, on desktop and mobile." },
    ],
    closing: "Open any product page and scroll past the screenshots to see its timeline.",
  },
  {
    slug: "direct-view-links",
    date: "2026-10-17",
    time: "21:04",
    title: "Links Open Straight to Their View",
    subtitle: "Analytics, Collection and Notes links no longer show the homepage first",
    bullets: [
      { lead: "No flash", text: "A link to Analytics, Collection or Notes shows that page from the first moment, with a short loading state while the data arrives." },
      { lead: "Canvas first", text: "Analytics now opens in Canvas, at 136% and centred on the cards; on narrow screens it still fits the cards to the screen." },
      { lead: "Shared links unchanged", text: "A link with its own view or zoom still opens exactly as it was shared." },
    ],
    closing: "Switch to Table any time with the toggle above the results.",
  },
  {
    slug: "shareable-analytics",
    date: "2026-10-17",
    time: "20:25",
    title: "Shareable Analytics Links",
    subtitle: "Send someone exactly the comparison you are looking at",
    bullets: [
      { lead: "Copy link", text: "The link keeps the mode, portals, weeks, device, view, zoom, card positions and the lines between cards." },
      { lead: "Your layout stays yours", text: "Opening a link shows its setup without replacing the layout you saved." },
      { lead: "Two weeks by default", text: "Over time now starts with the latest 2 weeks." },
      { lead: "Works in Table too", text: "Copy link sits at the right end of the Table/Canvas row in both views, on desktop and mobile." },
    ],
    closing: "Set up a canvas, click Copy link next to the zoom controls, and share it.",
  },
  {
    slug: "avatar-mask",
    date: "2026-10-16",
    time: "23:26",
    title: "Circular Avatar Masks",
    subtitle: "Keep the layout readable without showing who is signed in",
    bullets: [
      { lead: "Same shape, same place", text: "Avatars are covered with a neutral grey circle of the same size, so you can still see where the avatar sits." },
      { lead: "No account hints", text: "Photos, initials and generated avatar colors are all hidden." },
    ],
    closing: "Applies from the next weekly capture.",
  },
  {
    slug: "week-2026-10-12",
    date: "2026-10-16",
    title: "Week of Oct 12 Published",
    subtitle: "A new weekly snapshot of every AI portal",
    bullets: [
      { lead: "Fresh screenshots", text: "Desktop and mobile captures for every portal in the library." },
      { lead: "Design analysis", text: "Layout metrics and menu changes compared with the previous week." },
    ],
    closing: "Browse it from the homepage or the Analytics view.",
  },
  {
    slug: "confounds",
    date: "2026-10-16",
    time: "17:46",
    title: "Fairer Week-to-Week Comparisons",
    subtitle: "Separate real design changes from one-off noise",
    bullets: [
      { lead: "Confound notes", text: "Changes that pop-ups, onboarding or capture conditions may have caused are marked \"possibly confounded\" or \"confounded\"." },
      { lead: "Cleaner trends", text: "Marked changes are not counted as design changes." },
    ],
    closing: "Trends now reflect what the product team actually shipped.",
  },
  {
    slug: "one-address",
    date: "2026-10-14",
    time: "23:18",
    title: "One Address per Page",
    subtitle: "Every page now lives at a single URL",
    bullets: [
      { lead: "HTTPS everywhere", text: "http:// requests redirect permanently to https://." },
      { lead: "No more www", text: "www.ai-portal-library.dev redirects to ai-portal-library.dev, and query strings are kept." },
      { lead: "Preview links hidden from search", text: "Worker preview URLs are marked noindex." },
    ],
    closing: "Search engines now see one version of each page instead of three.",
  },
  {
    slug: "voice-plain-text",
    date: "2026-10-10",
    time: "20:24",
    title: "Voice Guide: Clearer Answers",
    subtitle: "Short, natural answers you can listen to",
    bullets: [
      { lead: "Plain text only", text: "Formatting symbols are removed before answers are spoken or shown." },
      { lead: "A correct \"this week\"", text: "Only portals that actually changed this week are listed." },
      { lead: "Bite-sized lists", text: "Spoken lists stop at three and offer to go through the rest." },
      { lead: "Suggested questions", text: "\"What changed this week?\", \"Compare ChatGPT and Claude\" and \"How has ChatGPT changed over the weeks?\"" },
    ],
    closing: "Ask out loud or type, and the guide answers in your language.",
  },
  {
    slug: "voice-data",
    date: "2026-10-10",
    time: "14:00",
    title: "Voice Guide: Answers From the Data",
    subtitle: "The guide works things out before it speaks",
    bullets: [
      { lead: "Pre-computed history", text: "Product groups and change history across weeks are worked out in code, not guessed by the model." },
      { lead: "Better hearing", text: "Product names help speech recognition catch misheard questions." },
    ],
    closing: "Answers now match what the library actually shows.",
  },
  {
    slug: "license",
    date: "2026-10-10",
    time: "11:56",
    title: "Analyses Under CC BY 4.0",
    subtitle: "Reuse the analysis with credit",
    bullets: [
      { lead: "Open analysis", text: "Design analysis text and menu change records are licensed under CC BY 4.0." },
      { lead: "Clear limits", text: "Screenshots, logos and trademarks belong to their owners and are not covered." },
    ],
    closing: "See the License page for details.",
  },
  {
    slug: "aeo",
    date: "2026-10-10",
    time: "11:45",
    title: "Built for AI Search and Agents",
    subtitle: "Easier for assistants to find, read and cite the library",
    bullets: [
      { lead: "Machine-readable pages", text: "/changes, /llms.txt, /llms-full.txt and a Markdown version of every portal page." },
      { lead: "Structured data", text: "WebSite, Dataset, Article and ItemList JSON-LD." },
      { lead: "Welcoming crawlers", text: "robots.txt names the major AI crawlers and allows them." },
    ],
    closing: "When an assistant answers a question about AI interfaces, it can point back here.",
  },
  {
    slug: "menu-consistency",
    date: "2026-10-10",
    time: "10:01",
    title: "Consistent Menu Tracking",
    subtitle: "The same rules for every product, every week",
    bullets: [
      { lead: "What counts", text: "Feature buttons like tools, model pickers, Think and Deep research are tracked. Basic send, mic and attach controls are not." },
      { lead: "Icon-only items", text: "Get a descriptive label so changes stay readable." },
      { lead: "Icon changes", text: "A new icon on an existing item is recorded too." },
    ],
    closing: "Menu comparisons are now reliable across all portals.",
  },
  {
    slug: "menu-tracking",
    date: "2026-10-09",
    time: "22:43",
    title: "Menu Changes Tracked",
    subtitle: "See when products add, remove or rename features",
    bullets: [
      { lead: "Navigation items", text: "Each analysis records a product's menu and compares it with the previous week." },
      { lead: "Renames caught", text: "For example, ChatGPT's \"Scheduled\" became \"Tasks\"." },
      { lead: "In the canvas", text: "The Analytics comparison box shows added, removed and renamed items." },
    ],
    closing: "Feature launches now show up next to the layout metrics.",
  },
  {
    slug: "hero-motion",
    date: "2026-10-09",
    time: "21:07",
    title: "A Livelier Homepage",
    subtitle: "Motion that explains what the library does",
    bullets: [
      { lead: "Grid draw-in", text: "The header grid draws itself in." },
      { lead: "Word-by-word subtitle", text: "The subtitle appears one word at a time, and key words are annotated." },
      { lead: "Smooth and respectful", text: "Animations don't freeze while the page loads, and they turn off for reduced-motion settings." },
    ],
    closing: "The first screen now shows what the library is about.",
  },
  {
    slug: "dark-default",
    date: "2026-10-09",
    title: "Dark Mode as the Capture Default",
    subtitle: "One consistent look for every weekly snapshot",
    bullets: [
      { lead: "Consistent captures", text: "Screenshots follow a dark appearance setting, so weeks stay comparable." },
      { lead: "Focused analysis", text: "One variant is analyzed each week to keep costs low." },
    ],
    closing: "Light captures are planned.",
  },
  {
    slug: "analytics-views",
    date: "2026-10-06",
    time: "17:33",
    title: "Analytics: Table and Canvas Views",
    subtitle: "Two ways to compare portals",
    bullets: [
      { lead: "Table and Canvas", text: "Switch between a sortable table and a visual canvas." },
      { lead: "Week picker", text: "Jump to any week from a dropdown." },
    ],
    closing: "A new controls layout keeps everything in one row.",
  },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-10-14" → "Oct 14, 2026" */
export function changelogDate(date: string): string {
  const [y, m, d] = date.split("-").map(Number);
  return `${MONTHS[m - 1]} ${d}, ${y}`;
}

/** The <time datetime> value: "2026-10-14T23:18-05:00", or just the date when there is no time. */
export function changelogDatetime(e: Pick<ChangelogEntry, "date" | "time">): string {
  return e.time ? `${e.date}T${e.time}${CHANGELOG_UTC_OFFSET}` : e.date;
}

/** "-05:00" → "UTC−5" (with a true minus sign); "+05:30" → "UTC+5:30". */
export function utcOffsetLabel(offset: string = CHANGELOG_UTC_OFFSET): string {
  const [, sign, hh, mm] = offset.match(/^([+-])(\d{2}):(\d{2})$/)!;
  return `UTC${sign === "-" ? "−" : "+"}${Number(hh)}${mm === "00" ? "" : `:${mm}`}`;
}

/** Newest entry date (YYYY-MM-DD), for the sitemap <lastmod>. */
export const CHANGELOG_UPDATED = CHANGELOG.map((e) => e.date).sort().at(-1)!;
