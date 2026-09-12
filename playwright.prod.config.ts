import { defineConfig, devices } from '@playwright/test';

/**
 * The same funnel suite, run against a production build.
 *
 * It deliberately starts no server. `webServer` here would launch `next dev`,
 * which shares and rewrites the `.next` directory that `next start` is serving
 * from — the two race, chunks are replaced underneath live requests, and the
 * result is spurious 500s with stack traces pointing at uninvolved route
 * handlers. Start the production server yourself first:
 *
 *   npm run build && npx next start -p 3100
 *   npm run test:e2e:prod
 */
export default defineConfig({
  testDir: './e2e',
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://unilag.localhost:3100',
    viewport: { width: 360, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } } },
  ],
});
