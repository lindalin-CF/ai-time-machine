import { defineConfig } from 'vitest/config';
import { readdirSync, readFileSync } from 'node:fs';

// Node-environment unit tests (npm test). Browser visual tests stay in vitest.config.mts (npm run test:visual).
//
// Two projects, run one after the other (sequence.groupOrder):
// - unit: plain Node tests, as many in parallel as there are CPUs.
// - browser: files that drive headless Chromium through Playwright, BROWSER_WORKERS at a time. Running one
//   Chromium per CPU starved the pages, so tests that pass alone timed out under load.
// A file belongs to "browser" when it imports from 'playwright'; it is the only way the tests start Chromium.

const DIR = 'tests/unit';
const BROWSER_WORKERS = 3;

const browserFiles = readdirSync(DIR)
  .filter((f) => f.endsWith('.test.ts') && /from ['"]playwright['"]/.test(readFileSync(`${DIR}/${f}`, 'utf8')))
  .map((f) => `${DIR}/${f}`);

export default defineConfig({
  test: {
    environment: 'node',
    // A full page load in headless Chromium can take a few seconds; 5s is too tight for it.
    testTimeout: 20_000,
    projects: [
      { extends: true, test: { name: 'unit', include: [`${DIR}/**/*.test.ts`], exclude: browserFiles, sequence: { groupOrder: 0 } } },
      { extends: true, test: { name: 'browser', include: browserFiles, maxWorkers: BROWSER_WORKERS, sequence: { groupOrder: 1 } } },
    ],
  },
});
