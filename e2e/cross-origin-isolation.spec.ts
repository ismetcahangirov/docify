/**
 * Cross-origin isolation, and the worker it exists for.
 *
 * `next.config.ts` puts `Cross-Origin-Opener-Policy` and
 * `Cross-Origin-Embedder-Policy: require-corp` on `/convert/*` so that
 * `SharedArrayBuffer` — and therefore multi-threaded ffmpeg.wasm and
 * wasm-vips — is available. What that configuration did not do until now was
 * let the conversion worker start at all.
 *
 * `require-corp` is not only about cross-origin subresources. A dedicated
 * worker is held to its owner document's policy, and Chromium refuses to start
 * one whose script came back without a matching `Cross-Origin-Embedder-Policy`
 * — same origin or not. Every conversion page rendered perfectly, accepted a
 * dropped file, and left the job on "Waiting" forever, with one line in the
 * console and an `ERR_BLOCKED_BY_RESPONSE` on a chunk under `/_next/static/`.
 *
 * Nothing in the unit suites could see it: jsdom has neither COEP nor a worker.
 * Nothing in the e2e suites could either, because none of them had ever dropped
 * a file. So this suite does exactly that, and asserts the three things that
 * have to hold together — the document is isolated, the chunks it fetches are
 * allowed to be, and a file dropped on the page comes back converted.
 */

import { expect, test } from '@playwright/test'

import { encodeBmp } from '../lib/engines/bmp'
import { fixtureFile } from './support/fixture-file'

/** A small real BMP, encoded by the shipping encoder rather than read off disk. */
const SOURCE = fixtureFile(
  'isolation.bmp',
  encodeBmp({
    width: 300,
    height: 200,
    data: new Uint8ClampedArray(
      Array.from({ length: 300 * 200 * 4 }, (_, index) =>
        index % 4 === 3 ? 255 : (index * 7) % 251,
      ),
    ),
  }),
)

test.describe('a conversion page', () => {
  test('is cross-origin isolated, which is what the engines need', async ({ page }) => {
    await page.goto('/convert/bmp-to-jpg')

    expect(await page.evaluate(() => globalThis.crossOriginIsolated)).toBe(true)
    expect(await page.evaluate(() => typeof SharedArrayBuffer)).toBe('function')
  })

  test('serves its own chunks with headers an isolated document accepts', async ({ page }) => {
    const blocked: string[] = []
    page.on('requestfailed', (request) => {
      if (request.failure()?.errorText.includes('BLOCKED_BY_RESPONSE')) blocked.push(request.url())
    })

    const response = await page.goto('/convert/bmp-to-jpg')
    await page.waitForLoadState('networkidle')

    expect(response?.headers()['cross-origin-embedder-policy']).toBe('require-corp')
    // The assertion the missing header would have failed. A blocked chunk is
    // not an error the page reports — it is a feature that silently is not there.
    expect(blocked).toEqual([])
  })

  test('converts a file that is dropped on it', async ({ page }) => {
    test.slow()

    await page.goto('/convert/bmp-to-jpg')

    const input = page.locator('[data-slot="dropzone-input"]')
    await expect(input).toBeAttached({ timeout: 30_000 })
    await input.setInputFiles(SOURCE)

    await expect(page.locator('[data-slot="job-card-state"]')).toHaveText('Done', {
      timeout: 60_000,
    })
    // A result to download, not merely a job that stopped saying "Converting".
    await expect(page.locator('[data-slot="result-panel-download"]').first()).toBeVisible()
  })
})
