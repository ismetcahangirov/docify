import { expect, test, type Page } from '@playwright/test'

import { encodeBmp } from '../lib/engines/bmp'

import { fixtureFile } from './support/fixture-file'

/**
 * Every conversion works with the backend unreachable (issue #86).
 *
 * The plan's first table says the backend is an *optional dependency, never on
 * the critical path*, and `test/app/backend-degradation.test.ts` checks that
 * one module at a time. This is the claim the unit suites structurally cannot
 * make: a real page, a real Web Worker, a real engine, a real file — with every
 * request to `/api/stats` failing at the network layer, the way it would if
 * Neon were down, the function were cold-starting into an error, or the visitor
 * were behind a filter that blocks the path.
 *
 * ## Why the requests are aborted rather than answered 500
 *
 * A 500 is the polite failure. An aborted request is the one that produces a
 * `TypeError` in the page, a red line in the console, and — if anything ever
 * awaited the beacon — a rejected promise inside the queue. If the app survives
 * the rude version it survives the polite one.
 *
 * ## Why the console is asserted and not only the UI
 *
 * "The UI shows no error" is the acceptance criterion, and a green job card
 * satisfies it while an uncaught exception is being logged behind it. The
 * console is where the difference between *handled* and *invisible* shows up.
 *
 * One line is expected and excluded: Chromium logs `Failed to load resource:
 * net::ERR_FAILED` for the request this suite aborts, from the network stack,
 * before any page code runs. No application can suppress it and no application
 * caused it. Everything else — anything thrown, anything any of our code
 * logged — has to be absent, and the exclusion is matched against the failed
 * request's own URL so it cannot quietly swallow a second, real error.
 */

/** A bitmap big enough to be a real conversion and small enough to be quick. */
const SOURCE = fixtureFile(
  'degradation.bmp',
  encodeBmp({
    width: 600,
    height: 400,
    data: new Uint8ClampedArray(
      Array.from({ length: 600 * 400 * 4 }, (_, index) =>
        index % 4 === 3 ? 255 : (index * 5) % 251,
      ),
    ),
  }),
)

/** Chromium's own network-stack log for a request that never completed. */
const BROWSER_NETWORK_LOG = /^Failed to load resource: net::ERR_/

interface PageErrors {
  /** Anything the page threw and nobody caught. Never acceptable. */
  thrown: string[]
  /** Anything logged as an error, minus the browser's note about the abort. */
  logged: string[]
}

function watchForErrors(page: Page): PageErrors {
  const errors: PageErrors = { thrown: [], logged: [] }

  page.on('console', (message) => {
    if (message.type() !== 'error') return

    // The browser's own line about the abort is attributed to the URL that
    // failed, so excluding it by URL cannot also hide an error our code logged.
    const isTheAbort =
      BROWSER_NETWORK_LOG.test(message.text()) && message.location().url.includes('/api/stats')

    if (!isTheAbort) errors.logged.push(message.text())
  })

  page.on('pageerror', (error) => errors.thrown.push(String(error)))

  return errors
}

/**
 * Makes `/api/stats` unreachable, and counts the attempts.
 *
 * The count is what stops this suite passing vacuously: an app that had quietly
 * stopped reporting anything would survive a broken endpoint trivially, and
 * would tell us nothing about what happens when a real one breaks.
 */
async function breakTheBackend(page: Page): Promise<{ attempts: () => number }> {
  let attempts = 0

  await page.route('**/api/stats**', async (route) => {
    attempts += 1
    await route.abort('failed')
  })

  return { attempts: () => attempts }
}

test.describe('with the backend unreachable', () => {
  test('a conversion still finishes, and nothing about it looks broken', async ({ page }) => {
    test.slow()

    const errors = watchForErrors(page)
    const backend = await breakTheBackend(page)

    await page.goto('/convert/bmp-to-jpg')

    const input = page.locator('[data-slot="dropzone-input"]')
    await expect(input).toBeAttached({ timeout: 30_000 })
    await input.setInputFiles(SOURCE)

    await expect(page.locator('[data-slot="job-card-state"]')).toHaveText('Done', {
      timeout: 60_000,
    })

    // The counter was attempted and failed, so the assertion above is about a
    // broken backend rather than about an app that never calls one.
    expect(backend.attempts()).toBeGreaterThan(0)

    // No apology appeared next to a conversion that worked. Asserted on the
    // card's own failure block rather than on the words: a conversion page is
    // full of prose about what can go wrong, and matching text would fail on
    // the FAQ.
    await expect(page.locator('[data-slot="job-card-failure"]')).toHaveCount(0)

    // Nothing was thrown, and nothing was logged except the browser's own note
    // about the request this test broke on purpose.
    expect(errors).toEqual({ thrown: [], logged: [] })
  })

  test('the finished file is still there to download', async ({ page }) => {
    test.slow()

    await breakTheBackend(page)
    await page.goto('/convert/bmp-to-jpg')

    const input = page.locator('[data-slot="dropzone-input"]')
    await expect(input).toBeAttached({ timeout: 30_000 })
    await input.setInputFiles(SOURCE)

    await expect(page.locator('[data-slot="job-card-state"]')).toHaveText('Done', {
      timeout: 60_000,
    })

    // The point of the app, and the thing a failed counter must never cost.
    const download = page.locator('[data-slot="result-panel-download"]').first()

    await expect(download).toBeVisible({ timeout: 10_000 })
    await expect(download).toHaveAttribute('download', /\.jpg$/)
    await expect(download).toHaveAttribute('href', /^blob:/)
  })
})

test.describe('the figures endpoint', () => {
  test('answers 200 and says so when there is no database', async ({ request }) => {
    // CI runs with no `DATABASE_URL`, so this is not a simulation — it is the
    // production build answering for real with nothing behind it.
    const response = await request.get('/api/stats')

    expect(response.status()).toBe(200)
    expect(await response.json()).toEqual({ available: false })
  })

  test('accepts a counter it cannot store', async ({ request }) => {
    const response = await request.post('/api/stats', {
      data: { pair: 'bmp-to-jpg', outcome: 'success', bucket: 'xs' },
    })

    expect(response.status()).toBe(202)
  })
})
