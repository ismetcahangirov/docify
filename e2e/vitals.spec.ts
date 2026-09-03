/**
 * The Core Web Vitals, measured rather than asserted about (issues #77, #78, #79).
 *
 * Two page shapes are measured, and they are the only two the site has: the
 * home page, which is marketing and nothing else, and a conversion page, which
 * is the same static markup with one deferred interactive island in the middle
 * of it. The other 123 conversion pages are that second shape with different
 * words in it.
 *
 * Both are measured under the CPU and network throttling `./support/vitals`
 * describes, and each number is the best of three loads. A vitals suite run
 * unthrottled on an idle machine over loopback passes with the fonts blocking
 * and the island eager, which is the only interesting way for it to fail; a
 * suite that asserts on a single run under eight parallel workers fails for
 * reasons that have nothing to do with the page.
 */

import { expect, test } from '@playwright/test'

import { encodeBmp } from '../lib/engines/bmp'
import { fixtureFile } from './support/fixture-file'
import {
  best,
  MAX_CLS,
  MAX_INP_MS,
  MAX_LCP_MS,
  MAX_TBT_MS,
  measureLoad,
  observeVitals,
  readVitals,
  resetVitals,
  settle,
  throttleToLabConditions,
  totalBlockingTime,
} from './support/vitals'

/** The two page shapes. Every other conversion page is the second one. */
const PAGES = [
  { path: '/', label: 'the home page' },
  { path: '/convert/heic-to-jpg', label: 'a conversion page' },
] as const

for (const { path, label } of PAGES) {
  test.describe(`${label} (${path})`, () => {
    test('paints its largest element inside the LCP budget', async ({ page }) => {
      await observeVitals(page)
      await throttleToLabConditions(page)

      const runs = await measureLoad(page, path)

      // Zero would mean nothing painted at all, which passes a `lessThan` and
      // is exactly the regression this suite exists to catch.
      for (const run of runs) expect(run.lcp).toBeGreaterThan(0)
      expect(best(runs, (run) => run.lcp)).toBeLessThan(MAX_LCP_MS)
    })

    test('does not move anything once it has painted', async ({ page }) => {
      await observeVitals(page)
      await throttleToLabConditions(page)

      const runs = await measureLoad(page, path)

      expect(best(runs, (run) => run.cls)).toBeLessThan(MAX_CLS)
    })

    test('blocks the main thread for less than the load budget', async ({ page }) => {
      await observeVitals(page)
      await throttleToLabConditions(page)

      const runs = await measureLoad(page, path)

      // Hydration, on a CPU four times slower than the host's. Conversion is
      // not in this number and must never be: it runs in a Web Worker
      // (CLAUDE.md §2.2), on a thread this observer cannot see.
      expect(best(runs, totalBlockingTime)).toBeLessThan(MAX_TBT_MS)
    })
  })
}

test.describe('interacting with a conversion page', () => {
  test.beforeEach(async ({ page }) => {
    await observeVitals(page)
    await throttleToLabConditions(page)
    await page.goto('/convert/heic-to-jpg')
    await settle(page)
  })

  test('answers a keyboard interaction inside the INP budget', async ({ page }) => {
    // The keyboard rather than a click: the file input is
    // visually-hidden-but-focusable and reached with Tab by design — see the
    // header of `components/converter/dropzone.tsx`. Enter would open a native
    // picker, so what is measured stops at moving focus through the page.
    await resetVitals(page)
    for (let press = 0; press < 4; press += 1) await page.keyboard.press('Tab')
    await settle(page)

    const { interactions } = await readVitals(page)

    expect(Math.max(0, ...interactions)).toBeLessThan(MAX_INP_MS)
  })

  test('does not shift the page when the deferred island mounts', async ({ page }) => {
    // The island loads after the static markup, and a component that appears
    // where nothing was reserved for it pushes everything below it down. Its
    // skeleton is sized for that reason; this is the assertion that says so.
    await expect(page.locator('[data-slot="dropzone-input"]')).toBeAttached({ timeout: 30_000 })
    await settle(page)

    expect((await readVitals(page)).cls).toBeLessThan(MAX_CLS)
  })
})

test.describe('while a conversion is running', () => {
  /**
   * A real BMP, encoded by the shipping encoder.
   *
   * 1200 × 900 is 4.3 MB of uncompressed pixels — enough that the canvas engine
   * has to decode, draw and re-encode something, rather than finishing inside
   * one frame and proving nothing. BMP because `lib/engines/bmp.ts` can produce
   * one in Node with no fixture on disk and no third-party encoder, and because
   * `bmp-to-jpg` is a page in the catalogue.
   */
  const source = fixtureFile(
    'measurement.bmp',
    encodeBmp({
      width: 1200,
      height: 900,
      data: new Uint8ClampedArray(
        Array.from({ length: 1200 * 900 * 4 }, (_, index) =>
          index % 4 === 3 ? 255 : (index * 7) % 251,
        ),
      ),
    }),
  )

  test('never blocks the main thread, because the work is on another one', async ({ page }) => {
    test.slow()

    await observeVitals(page)
    await throttleToLabConditions(page)
    await page.goto('/convert/bmp-to-jpg')
    await settle(page)

    const input = page.locator('[data-slot="dropzone-input"]')
    await expect(input).toBeAttached({ timeout: 30_000 })

    // Everything before this point is hydration, which is not evidence about a
    // conversion and would be the largest number in the set.
    await resetVitals(page)

    // A path, never a buffer. Playwright's buffer form base64-decodes the file
    // inside the page, on the thread this test is measuring — see the header of
    // `./support/fixture-file`.
    await input.setInputFiles(source)

    await expect(page.locator('[data-slot="job-card-state"]')).toHaveText('Done', {
      timeout: 60_000,
    })

    const { longTasks } = await readVitals(page)
    const worst = Math.max(0, ...longTasks)

    // The headline invariant, measured: CLAUDE.md §2.2 puts every engine in a
    // Web Worker so that the UI never freezes. If decoding a 4 MB bitmap and
    // re-encoding it as JPEG ever showed up on this thread, it would show up
    // here first — as one task hundreds of milliseconds long, on a CPU four
    // times slower than the host's.
    expect({ worst, tasks: longTasks.length }).toEqual({
      worst: Math.min(worst, MAX_INP_MS),
      tasks: longTasks.length,
    })
  })
})
