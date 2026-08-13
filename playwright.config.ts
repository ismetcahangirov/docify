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
    env: { PORT: String(PORT) },
    reuseExistingServer: !process.env.CI,
    // Covers `next build` on a cold runner, not just server boot. The static
    // generation pass grows with every SEO pair page, so this is deliberately roomy.
    timeout: 300_000,
  },
})
