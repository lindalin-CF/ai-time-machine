import { defineConfig } from 'vitest/config';

// Node-environment unit tests (npm test). Browser visual tests stay in vitest.config.mts (npm run test:visual).
export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
  },
});
