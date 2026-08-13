/**
 * The canvas engine, against a real browser.
 *
 * The unit suites drive the runner with fakes, because `OffscreenCanvas` and
 * `createImageBitmap` do not exist under jsdom. That covers the choreography and
 * nothing about the platform — and two of the claims in issue #30 are entirely
 * claims about the platform:
 *
 * 1. Chromium can read the BMP files `lib/engines/bmp.ts` writes by hand. A
 *    header field in the wrong place produces a file that opens nowhere, and no
 *    amount of asserting byte offsets in Node would catch a misreading of the
 *    format.
 * 2. `convertToBlob` really writes PNG, JPEG and WebP — with nothing downloaded.
 *
 * So the BMP bytes are produced here in Node by the shipping encoder, handed to
 * the page, and decoded by the browser's own decoder.
 */

import { expect, test, type Page } from '@playwright/test'

import { encodeBmp, type RgbaImage } from '../lib/engines/bmp'

/** Four opaque pixels, one per corner of a 2×2 image. */
const OPAQUE: RgbaImage = {
  width: 2,
  height: 2,
  data: new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]),
}

/** Fully transparent, fully opaque, and one in between. */
const TRANSLUCENT: RgbaImage = {
  width: 3,
  height: 1,
  data: new Uint8ClampedArray([10, 20, 30, 0, 40, 50, 60, 255, 70, 80, 90, 128]),
}

/**
 * Decodes an encoded image in the browser with `createImageBitmap`, draws it and
 * reads the pixels back — the exact path a converted file takes when the user
 * opens it again.
 */
async function decodeInBrowser(page: Page, bytes: Uint8Array, type: string) {
  return page.evaluate(
    async (payload: { bytes: number[]; type: string }) => {
      const blob = new Blob([new Uint8Array(payload.bytes)], { type: payload.type })
      const bitmap = await createImageBitmap(blob)
      const { width, height } = bitmap

      const canvas = new OffscreenCanvas(width, height)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('this browser gave up no 2d context')

      context.drawImage(bitmap, 0, 0)
      bitmap.close()

      return { width, height, pixels: [...context.getImageData(0, 0, width, height).data] }
    },
    { bytes: [...bytes], type },
  )
}

test.describe('the canvas engine in a real browser', () => {
  test('Chromium decodes the 24-bit BMP the engine writes for an opaque image', async ({
    page,
  }) => {
    await page.goto('/')

    const decoded = await decodeInBrowser(page, encodeBmp(OPAQUE), 'image/bmp')

    expect(decoded.width).toBe(2)
    expect(decoded.height).toBe(2)
    // Lossless in both directions, so the pixels have to come back untouched —
    // including the bottom-up row order, which is where a BMP writer goes wrong.
    expect(decoded.pixels).toEqual([...OPAQUE.data])
  })

  test('Chromium decodes the 32-bit BMP the engine writes when alpha is present', async ({
    page,
  }) => {
    await page.goto('/')

    const decoded = await decodeInBrowser(page, encodeBmp(TRANSLUCENT), 'image/bmp')

    expect(decoded.width).toBe(3)
    expect(decoded.height).toBe(1)
    // A canvas stores colours premultiplied, so a partly transparent pixel can
    // lose a little precision on the way back out. The alpha channel itself is
    // exact, and that is the claim being made: the transparency survived rather
    // than being composited away.
    expect(decoded.pixels[3]).toBe(0)
    expect(decoded.pixels[7]).toBe(255)
    expect(decoded.pixels[11]).toBe(128)
    expect(decoded.pixels.slice(4, 7)).toEqual([40, 50, 60])
  })

  test('writes JPEG, PNG and WebP through the browser, and reads each one back', async ({
    page,
  }) => {
    await page.goto('/')

    const written = await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(4, 4)
      const context = canvas.getContext('2d')
      if (context === null) throw new Error('this browser gave up no 2d context')

      context.fillStyle = '#123456'
      context.fillRect(0, 0, 4, 4)

      const results: { requested: string; produced: string; decodedWidth: number }[] = []

      for (const type of ['image/png', 'image/jpeg', 'image/webp']) {
        const blob = await canvas.convertToBlob({ type, quality: 0.92 })
        const bitmap = await createImageBitmap(blob)
        results.push({ requested: type, produced: blob.type, decodedWidth: bitmap.width })
        bitmap.close()
      }

      return results
    })

    expect(written).toHaveLength(3)
    for (const result of written) {
      // A browser that cannot write the type is specified to fall back to PNG
      // silently; the engine treats that as a failure, and so does this.
      expect(result.produced).toBe(result.requested)
      expect(result.decodedWidth).toBe(4)
    }
  })

  test('costs no download: the whole pipeline is already in the browser', async ({ page }) => {
    await page.goto('/')

    const requests: string[] = []
    page.on('request', (request) => requests.push(request.url()))

    await page.evaluate(async () => {
      const canvas = new OffscreenCanvas(8, 8)
      canvas.getContext('2d')?.fillRect(0, 0, 8, 8)
      const blob = await canvas.convertToBlob({ type: 'image/webp' })
      const bitmap = await createImageBitmap(blob)
      bitmap.close()
    })

    expect(requests).toEqual([])
  })
})
