// Shared wording for screenshots and weekly pages. public/app.js has the same two helpers
// (weekInWords, shotAlt); tests/unit/image-seo.test.ts checks they agree.

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];

/** "2026-09-21" -> "September 21, 2026". Anything that isn't a YYYY-MM-DD date is returned unchanged. */
export function weekInWords(week: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(week);
  if (!m) return week;
  const month = MONTHS[Number(m[2]) - 1];
  return month ? `${month} ${Number(m[3])}, ${m[1]}` : week;
}

/** Alt text for a weekly screenshot: "ChatGPT desktop interface, week of September 21, 2026". */
export function shotAlt(portal: string, device: "desktop" | "mobile", week: string): string {
  return `${portal} ${device} interface, week of ${weekInWords(week)}`;
}
