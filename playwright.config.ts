import { defineConfig, devices } from '@playwright/test'

const PORT = Number(process.env.PORT ?? 3000)
const BASE_URL = `http://127.0.0.1:${PORT}`

// End-to-end tests run against a production build, because that is what ships
// and what the client-side conversion pipeline will be measured on. Chromium is
// the only project: CI installs that single browser, and the engines Docify
// depends on (WebCodecs, SharedArrayBuffer) are Chromium-first.
//
// Locally an already-listening server is reused, so a `pnpm dev` session on the
// same port is tested instead of a production build. CI never reuses.
//
// `NEXT_PUBLIC_PROXY_URL` is set for the build because it is a *build-time*
// constant: without one the URL-import control renders nothing at all
// (issue #270), and a suite that never sees the control cannot say whether a
// dead proxy blocks a drop. The origin below exists nowhere — every request to
// it is intercepted by `e2e/backend-degradation.spec.ts`, and any that is not
// simply fails, which is the state under test.
const PROXY_URL = 'https://proxy.docify.invalid'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: process.env.CI ? 2 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: process.env.CI
    ? [['github'], ['html', { open: 'never' }]]
    : [['list'], ['html', { open: 'never' }]],
  use: {
    baseURL: BASE_URL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
  /*
   * Two projects, because one of these files is not asserting about the DOM —
   * it is taking a measurement (issue #300).
   *
   * `vitals.spec.ts` throttles the CPU to a quarter of the host's and then
   * reads latencies off the page. Run in the shared pool it competes with
   * however many other browsers `fullyParallel` has started, and the number it
   * reads is about the runner rather than about the page: measured alone, the
   * keyboard interaction on a conversion page is 24-40ms against a 200ms
   * budget, and under eight workers the same interaction reads 320ms. Total
   * Blocking Time inflates the same way — 140ms documented in
   * `./e2e/support/vitals.ts`, 335ms observed contended, which is past the
   * budget even after `measureLoad` takes the best of three.
   *
   * So the measurements get the machine to themselves: `dependencies` holds
   * them until every other spec has finished, and `fullyParallel: false` keeps
   * them from racing each other. CI was already immune — it pins `workers: 1`
   * — which is exactly why this only ever failed on a developer's laptop, and
   * why it was tempting to read as a page regression rather than as noise.
   */
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
      testIgnore: /vitals\.spec\.ts/,
    },
    {
      name: 'vitals',
      use: { ...devices['Desktop Chrome'] },
      testMatch: /vitals\.spec\.ts/,
      dependencies: ['chromium'],
      fullyParallel: false,
    },
  ],
  webServer: {
    command: 'pnpm build && pnpm start',
    url: BASE_URL,
    env: { PORT: String(PORT), NEXT_PUBLIC_PROXY_URL: PROXY_URL },
    reuseExistingServer: !process.env.CI,
    // Covers `next build` on a cold runner, not just server boot. The static
    // generation pass grows with every SEO pair page, so this is deliberately roomy.
    timeout: 300_000,
  },
})
