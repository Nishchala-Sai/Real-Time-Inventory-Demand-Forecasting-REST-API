import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    projects: [
      { test: { name: 'forecast', root: 'packages/forecast', include: ['test/**/*.test.js'] } },
      {
        extends: 'frontend/vite.config.js',
        root: 'frontend',
        test: {
          name: 'frontend',
          include: ['test/**/*.test.jsx'],
          environment: 'jsdom',
          setupFiles: ['test/setup.js'],
        },
      },
      {
        test: {
          name: 'backend',
          root: 'backend',
          include: ['test/**/*.test.js'],
          globalSetup: ['test/globalSetup.js'],
          hookTimeout: 180_000,
          testTimeout: 30_000,
          env: {
            NODE_ENV: 'test',
            MONGODB_URI: 'mongodb://set-by-test-helpers/inventory',
            JWT_ACCESS_SECRET: 'test-access-secret-that-is-long-enough',
            JWT_REFRESH_SECRET: 'test-refresh-secret-that-is-long-enough',
            APP_ORIGIN: 'http://localhost:5173',
            STORE_TZ: 'UTC',
            ADMIN_EMAIL: 'admin@example.com',
            ADMIN_PASSWORD: 'test-admin-password',
          },
        },
      },
    ],
    coverage: {
      provider: 'v8',
      include: ['packages/forecast/src/**', 'backend/src/**'],
      exclude: ['backend/src/server.js'],
      thresholds: {
        'packages/forecast/src/**': { lines: 95 },
        'backend/src/**': { lines: 80 },
      },
    },
  },
});
