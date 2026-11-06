import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'forecast', root: 'packages/forecast', include: ['test/**/*.test.js'] } },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/forecast/src/**'],
      thresholds: { 'packages/forecast/src/**': { lines: 95 } },
    },
  },
});
