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
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
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
