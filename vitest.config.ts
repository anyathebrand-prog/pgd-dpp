import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    // The isolation suite talks to a real Postgres with real RLS policies.
    // Mocking the database would test the mock, not the thing that matters.
    testTimeout: 20_000,
    include: ['tests/**/*.test.ts'],
  },
});
