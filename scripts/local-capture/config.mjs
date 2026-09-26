// Shared settings for capture.mjs and analysis/*.mjs.
// UPLOAD_TOKEN is only ever read from the environment; never hardcode it or write it to a file.
export const WORKER_URL = (process.env.WORKER_URL || "https://ai-portal-library.monthtest970509.workers.dev").replace(/\/$/, "");
export const UPLOAD_TOKEN = process.env.UPLOAD_TOKEN;
