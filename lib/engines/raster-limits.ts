/**
 * Two ceilings on decoded pixels, and the arithmetic behind each.
 *
 * ## Why the router cannot impose either
 *
 * `route()` is handed byte counts and never opens a file (CLAUDE.md §5.1), so
 * every number in `MEMORY` is a multiple of the input's *size*. A decoded bitmap
 * is `width × height × bytes-per-pixel` however well the file compressed, and
 * the two are not related: twelve 1500 × 2000 screenshots weigh 750 kB and peak
 * at up to 193 MB through `./pdf-from-images`, while the same pixel count as
 * photographic grain is 103 MB of input for 184 MB of peak. No factor and no
 * fixed reserve describes both. The guard has to sit beside the bytes being
 * decoded, shaped after `canvasSize()` in `./pdf-render-plan`, which refuses a
 * page before anything is allocated. `docs/router/memory-budget-measurement.md`
 * is the measurement.
 *
 * ## Why two ceilings and not one
 *
 * They answer different questions and only one of them is a memory budget.
 *
 * {@link assertDecodedPixelsFit} is the **measured** bound, and it exists for
 * the case the issue was filed for: `embedPng` holds every image's samples
 * uncompressed until `save()`, so an images → PDF job's cost accumulates across
 * files and nothing fixed describes it. It is a function of the device budget.
 *
 * {@link assertBitmapFits} is the **factual** bound for the engines that decode
 * through a browser bitmap. A canvas past {@link MAX_BITMAP_SIDE} or
 * {@link MAX_BITMAP_PIXELS} yields a blank surface rather than an exception, so
 * this refuses a file no browser could have rendered anyway. It is deliberately
 * *not* derived from the memory budget: what a decoded `ImageBitmap` plus its
 * canvas actually costs has never been measured — `createImageBitmap` and
 * `OffscreenCanvas` have no Node stand-in, which is why `MEMORY.canvas` and
 * `MEMORY.heif` are unmeasured too — and a ceiling built from an estimated
 * per-pixel cost against a deliberately conservative budget would refuse a
 * 12 megapixel phone photo, which is the single commonest input the app has.
 * Refusing the common case to prevent a crash that has not been measured is a
 * worse trade than the crash. Measuring it needs the browser harness
 * `docs/router/memory-budget-measurement.md` says has not been built.
 *
 * ## One helper, not four copies
 *
 * `pdf-from-images`, `canvas` and `heif` need the same arithmetic and — the part
 * that settles it — the same sentence, because a refusal whose wording changes
 * with the engine teaches the user nothing (CLAUDE.md §2.5). `vips` is
 * deliberately guarded by neither: libvips streams in scanline regions and never
 * materialises the bitmap either ceiling would be protecting. See its module
 * header.
 */

import { DESKTOP_BUDGET_FLOOR_BYTES } from '@/lib/router/budget'

import type { ImageSize } from './raster-size'

/**
 * The budget assumed when the caller does not say which device this is.
 *
 * `budgetBytes(caps)` is pure and is the right number, but it has to be passed
 * in: the conversion worker carries no `Capabilities`, deliberately, because it
 * never re-routes (CLAUDE.md §2.4, `lib/worker/types.ts`). `EngineInput
 * .budgetBytes` is how a caller that has already routed hands its answer over.
 *
 * The fallback is the *floor* rather than the iOS ceiling, and that is a
 * deliberate departure from "assume the weakest device". This is a second bound
 * on an axis the router cannot see, not a replacement for the router's own
 * check — that one already ran, against the real device budget, on the job's
 * bytes. Assuming a phone here would refuse on a workstation a job measured at
 * 118 MB against a 1200 MB allowance. The floor still refuses the runaway case
 * this exists for, on every device.
 */
export const DEFAULT_BUDGET_BYTES = DESKTOP_BUDGET_FLOOR_BYTES

/**
 * What one decoded pixel costs pdf-lib, measured.
 *
 * `embedPng` decodes to raw samples and holds them *uncompressed* until
 * `save()` deflates them, so an images → PDF job keeps every image's pixels
 * alive at once. The sweep in `docs/router/memory-budget-measurement.md` runs
 * the same flat PNG at one, three, six, twelve and twenty-four images: the
 * measured curve crosses the 90 MB iOS budget at 12.0 megapixels, which is 7.83
 * bytes per pixel, and 8 is the next whole number up.
 *
 * JPEG is charged nothing, and that is not an oversight: `embedJpg` scans to
 * SOF0 and copies the bytes into a `DCTDecode` stream without running a Huffman
 * decoder, which is why `images-jpg-24` carries 288 Mpx and still peaks at 1.7×
 * its bytes. Those bytes the router already budgets — and it is why a phone
 * making a PDF of its own camera roll is unaffected by any of this.
 */
export const PDFLIB_DECODED_BYTES_PER_PIXEL = 8

/**
 * Canvas limits, taken from the strictest mainstream implementation rather than
 * the most generous.
 *
 * Safari refuses a canvas past 16 384 px on either axis and browsers cap total
 * area independently of that. Exceeding either yields a blank surface rather
 * than an exception — the conversion "succeeds" and the user downloads an empty
 * image — so the check has to happen before anything is allocated.
 *
 * The same two numbers appear as `MAX_CANVAS_SIDE` and `MAX_CANVAS_PIXELS` in
 * `./pdf-render-plan`, which reached them first and for the same reason. They
 * are stated again here rather than imported because that module pulls the
 * whole pdf.js page-planning graph in behind it, and this one is reached from
 * the canvas engine, whose entire point is that it downloads nothing.
 */
export const MAX_BITMAP_SIDE = 16_384
export const MAX_BITMAP_PIXELS = 67_108_864

const MEGAPIXEL = 1_000_000
const MB = 1024 * 1024

/**
 * How to refer to a file in a refusal.
 *
 * `EngineInput.files` is typed as `Blob` because that is all the contract needs,
 * but the worker forwards the user's `File` objects, which carry the name that
 * makes a rejection actionable — "unsupported image" leaves someone re-checking
 * twelve holiday photos to find which one their phone saved as HEIC. The
 * position is the fallback for a multi-file job; a single-file engine passes no
 * index and gets a sentence that reads without one.
 */
export function imageLabel(file: Blob, index?: number): string {
  const name: unknown = (file as { name?: unknown }).name
  if (typeof name === 'string' && name.length > 0) return `"${name}"`

  return index === undefined ? 'This image' : `Image ${index + 1}`
}

/**
 * The most decoded pixels that fit in `budgetBytes` at `bytesPerPixel`.
 *
 * A whole number, so it can be compared against a pixel count without a
 * rounding argument, and floored rather than rounded — the limit is a ceiling,
 * not an estimate. A per-pixel cost that is not a positive finite number
 * answers `0` rather than `Infinity`: this is a memory ceiling, and the worst
 * failure it could have is silently admitting everything.
 */
export function maxDecodedPixels(
  bytesPerPixel: number,
  budgetBytes: number = DEFAULT_BUDGET_BYTES,
): number {
  if (!Number.isFinite(bytesPerPixel) || bytesPerPixel <= 0) return 0
  if (!Number.isFinite(budgetBytes) || budgetBytes <= 0) return 0

  return Math.floor(budgetBytes / bytesPerPixel)
}

/** One image's contribution to a job, and the ceiling it is measured against. */
export interface DecodedPixelCheck {
  /** How the image is referred to in the rejection — quoted name, or position. */
  label: string
  /** The dimensions read from the header, before anything is decoded. */
  size: ImageSize
  /**
   * Decoded pixels the job reaches *including* this image. Omit for an engine
   * that decodes one file at a time and releases it before the next. Never
   * counts for less than this image alone.
   */
  jobPixels?: number
  bytesPerPixel: number
  /** From `budgetBytes(caps)` where it is known; {@link DEFAULT_BUDGET_BYTES} where it is not. */
  budgetBytes?: number
}

/**
 * Refuses a job whose decoded pixels cannot fit the memory budget.
 *
 * Synchronous and called before the decoder is handed anything, which is the
 * whole point: by the time an out-of-memory shows up as a failed allocation the
 * tab is usually already gone. Inclusive of the limit, like `fitsInBudget`.
 *
 * The message names the file, its dimensions and the ceiling in the same unit
 * (CLAUDE.md §2.5), and the suggestion differs by case because the fix does: one
 * oversized image is resized, a long batch of ordinary ones is split up.
 */
export function assertDecodedPixelsFit(check: DecodedPixelCheck): void {
  const { label, size, bytesPerPixel, budgetBytes = DEFAULT_BUDGET_BYTES } = check
  const ownPixels = size.width * size.height
  // Never below this image's own pixels: a caller that under-reports the running
  // total must not be able to talk the ceiling into admitting one huge file.
  const jobPixels = Math.max(check.jobPixels ?? ownPixels, ownPixels)
  const limit = maxDecodedPixels(bytesPerPixel, budgetBytes)

  if (jobPixels <= limit) return

  const dimensions = `${label} is ${size.width} × ${size.height} pixels`
  const ceiling =
    `about ${megapixels(limit)} megapixels, or ${Math.round(budgetBytes / MB)} MB ` +
    'of decoded image'

  if (jobPixels > ownPixels) {
    throw new Error(
      `${dimensions} and brings this job to ${megapixels(jobPixels)} megapixels, which is ` +
        `more than this device can decode at once — ${ceiling}. Build the document from ` +
        'fewer images at a time, or use the resize tool on them first.',
    )
  }

  throw new Error(
    `${dimensions}, which is ${megapixels(ownPixels)} megapixels and more than this device ` +
      `can decode at once — ${ceiling}. Use the resize tool to bring it under ` +
      `${square(limit)}, then convert the result.`,
  )
}

/**
 * Refuses an image no browser bitmap could hold, before one is asked for.
 *
 * Not a memory budget — see the module header. This is the size past which a
 * canvas comes back blank, so the alternative to refusing is an empty file
 * presented to the user as a successful conversion.
 */
export function assertBitmapFits(label: string, size: ImageSize): void {
  const { width, height } = size

  if (
    width <= MAX_BITMAP_SIDE &&
    height <= MAX_BITMAP_SIDE &&
    width * height <= MAX_BITMAP_PIXELS
  ) {
    return
  }

  throw new Error(
    `${label} is ${width} × ${height} pixels, which is larger than a browser canvas can ` +
      `hold — at most ${MAX_BITMAP_SIDE} pixels on a side and ${megapixels(MAX_BITMAP_PIXELS)} ` +
      'megapixels in total. Use the resize tool to bring it under that, then convert the result.',
  )
}

/** One decimal place: the number is an order-of-magnitude fact, not a budget line. */
function megapixels(pixels: number): string {
  return (pixels / MEGAPIXEL).toFixed(1)
}

/**
 * The limit expressed as a square, which is the only shape that can be quoted
 * without knowing the user's aspect ratio. Rounded down to 10 px so it reads as
 * guidance rather than as a threshold to hit exactly, and never below 10 —
 * "resize it below 0 × 0" is not an instruction anyone can follow.
 */
function square(limitPixels: number): string {
  const side = Math.max(10, Math.floor(Math.sqrt(limitPixels) / 10) * 10)

  return `${side} × ${side} pixels`
}
