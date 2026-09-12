import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(import.meta.dirname, 'src'),
      // `server-only` resolves to its throwing entry unless the bundler applies
      // the `react-server` export condition, which vitest does not. These tests
      // exercise server modules directly and deliberately, so it maps to the
      // package's own empty module rather than being stubbed out by hand.
      'server-only': resolve(import.meta.dirname, 'node_modules/server-only/empty.js'),
    },
  },
  test: {
    environment: 'node',
    // These suites talk to a real Postgres with real RLS policies and call the
    // real route handlers. Mocking either would test the mock rather than the
    // thing that actually has to be right.
    testTimeout: 30_000,
    setupFiles: ['tests/setup.ts'],
    include: ['tests/**/*.test.ts'],
    // Payment tests mutate shared rows, so they must not race each other.
    fileParallelism: false,
  },
});
