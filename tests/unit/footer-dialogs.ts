import { expect } from 'vitest';

// Shared checks for the footer copyright line and its two dialogs (homepage and portal pages carry the same markup).

export const EMAIL = 'contact@ai-portal-library.dev';

export const LEGAL_LINE =
  '&copy; 2026 AI Interface Library. All rights reserved. &middot; ' +
  '<button type="button" class="linkbtn" data-dialog="disclaimer" aria-haspopup="dialog">Disclaimer</button> &middot; ' +
  '<button type="button" class="linkbtn" data-dialog="contact" aria-haspopup="dialog">Contact</button>';

/** The <dialog> element with the given id, or undefined. */
export function dialogById(html: string, id: string): string | undefined {
  return html.match(new RegExp(`<dialog\\b[^>]*\\bid="${id}"[^>]*>[\\s\\S]*?</dialog>`))?.[0];
}

function expectClosedDialog(html: string, id: string, title: string): string {
  const dialog = dialogById(html, id);
  expect(dialog, `#${id} dialog`).toBeDefined();
  const openTag = dialog!.match(/<dialog\b[^>]*>/)![0];
  expect(openTag).toContain(`aria-labelledby="${id}-title"`);
  expect(openTag).not.toMatch(/\sopen\b/);
  expect(dialog).toContain(`<h2 id="${id}-title">${title}</h2>`);
  expect(dialog).toContain('<form method="dialog">');
  expect(dialog).toContain('<button type="submit" class="site-dialog-x" aria-label="Close">&times;</button>');
  expect(dialog).toContain('<button type="submit" class="site-dialog-close">Close</button>');
  return dialog!;
}

export function expectFooterDialogs(html: string): void {
  expect(html).toContain(LEGAL_LINE);
  // Contact is now a dialog button, not a mailto link in the footer line.
  expect(html).not.toMatch(/<a [^>]*>Contact<\/a>/);

  const disclaimer = expectClosedDialog(html, 'disclaimer', 'Disclaimer');
  expect(disclaimer).toContain('<p>Product screenshots, logos, and trademarks belong to their respective owners. AI Interface Library is an independent project, unaffiliated with the brands featured.</p>');
  expect(disclaimer).toContain('<p>Content is for reference and research. Screenshots may differ from current interfaces.</p>');

  const contact = expectClosedDialog(html, 'contact', 'Contact');
  expect(contact).toContain('<p>For removal requests, corrections or questions, email:</p>');
  expect(contact).toContain(`<span class="contact-address" data-copy-source>${EMAIL}</span>`);
  expect(contact).toContain(`<button type="button" class="contact-copy" data-copy="${EMAIL}" aria-live="polite">Copy</button>`);
  expect(contact).toContain(`<a class="contact-mail" href="mailto:${EMAIL}">Open email app</a>`);
  expect(html.match(/mailto:[^"]*/g)).toEqual([`mailto:${EMAIL}`]); // the only mailto on the page

  expect(html).toContain('<script src="/footer-dialogs.js" defer></script>');
  expect(html).not.toContain('/disclaimer.js');
  expect(html).not.toMatch(/showModal\(|\.show\(/); // nothing opens a dialog on load
}
