import { defineConfig, devices } from '@playwright/test';

/**
 * The funnel suite runs against a real dev server and a real seeded database.
 *
 * Tenant resolution comes from the Host header (§7.4), so the suite runs
 * against `unilag.localhost:3000` — the production mechanism. Chromium
 * resolves `*.localhost` to the loopback address natively, so this needs no
 * hosts-file entry.
 *
 * It deliberately does NOT use the `/t/{slug}` path fallback: server actions
 * redirect to absolute paths like `/apply`, which under path mode lose the
 * tenant prefix and land on the platform host. See the known limitation in the
 * README — the fallback is browse-only today.
 */
export default defineConfig({
  testDir: './e2e',
  // These walk a candidate through a stateful funnel. Running them in parallel
  // would have them competing for the same seeded cohort seats.
  workers: 1,
  fullyParallel: false,
  timeout: 60_000,
  /*
   * Twenty seconds, where the production config uses ten.
   *
   * `next dev` compiles a route the first time it is requested, and in a full
   * suite run that lands inside an assertion — which then fails on the speed
   * of the toolchain rather than on anything the product did. The same suite
   * against `next start` needs no such allowance, which is the tell that this
   * is a dev-server property and not a slow product.
   */
  expect: { timeout: 20_000 },
  reporter: [['list']],
  use: {
    baseURL: 'http://unilag.localhost:3000',
    // 360px is the design baseline (§4.2), so that is what the funnel is
    // tested at. If it works there it works on a desktop.
    viewport: { width: 360, height: 800 },
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 360, height: 800 } } }],
  webServer: {
    command: 'npm run dev',
    url: 'http://localhost:3000',
    reuseExistingServer: true,
    timeout: 120_000,
  },
});
