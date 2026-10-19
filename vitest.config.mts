import { defineConfig } from 'vitest/config';
import { playwright } from '@vitest/browser-playwright';

export default defineConfig({
  test: {
    // Browser visual tests only. Without this, Vite's browser dep optimizer crawls the Node unit tests too,
    // reaches playwright -> fsevents (a native module) and fails before any test runs.
    include: ['tests/visual/**/*.test.ts'],
    setupFiles: ['vitest-visual-diff'],
    browser: {
      enabled: true,
      headless: true,
      provider: playwright(),
      instances: [{ browser: 'chromium' }],
    },
  },
});
