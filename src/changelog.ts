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
