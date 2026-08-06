/// <reference types="@cloudflare/workers-types" />

// Weekly capture job passed through the Queue.
export interface CaptureJob {
  week: string;   // ISO Monday, e.g. "2026-08-03"
  slug: string;   // portal slug
}

export interface Env {
  // Static assets (the KUMO gallery front-end)
  ASSETS: Fetcher;
  // D1 — capture / portal / week metadata
  DB: D1Database;
  // R2 — screenshot PNG bytes
  SHOTS: R2Bucket;
  // KV — cached API responses + latest-week pointer
  CACHE: KVNamespace;
  // Workers AI — vision analysis
  AI: Ai;
  // Browser Rendering — headless Chromium
  BROWSER: Fetcher;
  // Queue producer — fan-out per-portal jobs
  CAPTURE_QUEUE: Queue<CaptureJob>;
  // Workflow — durable weekly orchestration
  CAPTURE_WORKFLOW: Workflow;
}

export interface PortalRow {
  slug: string;
  name: string;
  company: string;
  url: string;
  brand: string;
  wait_for: number;
  full_page: number;
  active: number;
  sort_order: number;
}

export interface CaptureRow {
  id: string;
  week: string;
  slug: string;
  portal: string;
  company: string;
  url: string;
  brand: string;
  r2_key: string | null;
  width: number;
  height: number;
  palette: string;      // JSON string
  analysis: string;
  analysis_by: string;
  status: string;
  captured_at: string;
}
