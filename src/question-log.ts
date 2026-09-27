// Anonymous question log for the voice guide.
//
// When analytics are allowed for a visitor (same rules as Google Analytics and Clarity: see
// public/consent.js and analyticsAllowed() in src/consent.ts), the text of each question they ask
// the voice guide is saved in D1 (table question_log, migrations/0008_question_log.sql). Only the
// scrubbed question, the date (no time) and whether it was typed or spoken are stored: no room name,
// IP address, user agent, country or session, and the row ID is random. Answers and audio are never
// logged. A daily cron deletes rows older than QUESTION_LOG_RETENTION_DAYS. There is no public API;
// scripts/local-capture/export-questions.mjs reads the table for analysis.

import type { Env } from "./types";
import { analyticsAllowed } from "./consent";

/** Set by the Worker on the voice WebSocket request it forwards to the Durable Object; "1" = log questions. */
export const QUESTION_LOG_HEADER = "x-question-log";

/** Daily at 03:30 UTC: delete old questions. Must match the second entry of triggers.crons in wrangler.jsonc. */
export const QUESTION_LOG_CRON = "30 3 * * *";

export const QUESTION_LOG_RETENTION_DAYS = 360;
export const MAX_QUESTION_LENGTH = 1000;
export const REMOVED = "[removed]";

export type QuestionInput = "typed" | "voice";

const EMAIL = /[^\s@<>()[\]"',;:]+@[^\s@<>()[\]"',;:]+\.[^\s@<>()[\]"',;:]+/g;
// A phone number: digits with optional +, spaces, dots, dashes and brackets, 7 or more digits in all.
const PHONE_CANDIDATE = /[+(]?\d[\d\s().-]{5,}\d/g;
const LONG_DIGITS = /\d{6,}/g;

/** Replace email addresses, phone numbers and runs of 6+ digits with "[removed]", then cap the length. */
export function scrubQuestion(text: string): string {
  const scrubbed = text
    .replace(EMAIL, REMOVED)
    .replace(PHONE_CANDIDATE, (m) => ((m.match(/\d/g)?.length ?? 0) >= 7 ? REMOVED : m))
    .replace(LONG_DIGITS, REMOVED)
    .replace(/\s+/g, " ")
    .trim();
  return scrubbed.slice(0, MAX_QUESTION_LENGTH);
}

/** UTC calendar date, YYYY-MM-DD. */
export function utcDate(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The voice WebSocket request as forwarded to the Durable Object: any client-supplied
 * x-question-log header is dropped, and the Worker sets it only when analytics are allowed.
 */
export function withQuestionLogPermission(request: Request): Request {
  const headers = new Headers(request.headers);
  headers.delete(QUESTION_LOG_HEADER);
  if (analyticsAllowed(request)) headers.set(QUESTION_LOG_HEADER, "1");
  return new Request(request, { headers });
}

/** Save one question, only when `allowed`. Stores the scrubbed text, the UTC date and the input type; nothing else. */
export async function logQuestion(
  env: Pick<Env, "DB">,
  allowed: boolean,
  text: string,
  input: QuestionInput,
  now = Date.now(),
): Promise<void> {
  if (!allowed) return;
  const question = scrubQuestion(text);
  if (!question) return;
  await env.DB.prepare("INSERT INTO question_log (id, day, input, question) VALUES (?, ?, ?, ?)")
    .bind(crypto.randomUUID(), utcDate(now), input, question)
    .run();
}

/** Delete questions older than 360 days: a row dated exactly 360 days ago is kept until the next day. */
export async function purgeOldQuestions(env: Pick<Env, "DB">, now = Date.now()): Promise<void> {
  const cutoff = utcDate(now - QUESTION_LOG_RETENTION_DAYS * 24 * 60 * 60 * 1000);
  await env.DB.prepare("DELETE FROM question_log WHERE day < ?").bind(cutoff).run();
}
