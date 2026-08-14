/**
 * The decoded-pixel ceiling, and the header readers that make it enforceable.
 *
 * ## Why this cannot live in the router
 *
 * `route()` is handed byte counts and never opens a file (CLAUDE.md §5.1), so
 * every number in `MEMORY` is a multiple of the input's *size*. A decoded bitmap
 * is `width × height × bytesPerPixel` however well the file compressed, and the
 * two are not related: twelve 1500 × 2000 screenshots weigh 750 kB and peak at
 * 189 MB through `./pdf-from-images` — 258× their bytes — while the same pixel
 * count as photographic grain is 103 MB of input for 184 MB of peak, or 1.8×.
 * No factor and no fixed reserve describes both rows. The measurement is in
 * `docs/router/memory-budget-measurement.md`; the guard has to be here, beside
 * the bytes being decoded, and it is shaped after `canvasSize()` in
 * `./pdf-render-plan`, which refuses a page before anything is allocated.
 *
 * ## One helper, not four copies
 *
 * `pdf-from-images`, `canvas` and `heif` all materialise a full decoded bitmap
 * and all need the same three things: a size read out of a header, the same
 * arithmetic against the same budget, and — the part that matters most — the
 * *same sentence*, because a rejection that varies by engine teaches the user
 * nothing (CLAUDE.md §2.5). What differs between them is one number, so
 * `bytesPerPixel` is a parameter and everything else is shared. A JPEG SOF0
 * reader written three times would be three subtly different marker walks.
 *
 * `vips` is deliberately **not** guarded. libvips never materialises the bitmap:
 * `newFromBuffer` with `access: 'sequential'` and `thumbnailBuffer`'s
 * shrink-on-load both work in scanline regions, which is why its factor is 4
 * against the canvas engine's 6. A pixel ceiling there would refuse jobs it
 * completes in a few hundred kilobytes.
 *
 * ## Which budget
 *
 * `budgetBytes(caps)` is pure and would be the right number to compare against,
 * but the conversion worker carries no `Capabilities` at all — `ConvertRequest`
 * in `lib/worker/types.ts` is deliberately just the engine id and the input, and
 * the worker never re-routes (CLAUDE.md §2.4). So the budget arrives here as an
 * optional parameter and defaults to {@link CONSERVATIVE_BUDGET_BYTES} when
 * nobody supplies one: the same choice `budgetForUnhandledPlatform` makes in
 * `lib/router/budget.ts`, for the same reason — an unknown device must not be
 * handed the largest allowance by a module whose failure mode is a killed tab.
 */

import { IOS_BUDGET_BYTES } from '@/lib/router/budget'

/** Pixel dimensions read from a file's header, before any decoder sees it. */
export interface ImageSize {
  readonly width: number
  readonly height: number
}

/**
 * The budget assumed when the caller does not know the device.
 *
 * iOS is the smallest ceiling any platform gets, and mobile Safari enforces it
 * by killing the tab without a catchable error. Assuming it costs a desktop
 * some headroom it could have used; assuming anything larger costs an iPhone
 * user their file.
 */
export const CONSERVATIVE_BUDGET_BYTES = IOS_BUDGET_BYTES

/**
 * What one decoded pixel costs pdf-lib, measured.
 *
 * `embedPng` decodes to raw samples and holds them *uncompressed* until
 * `save()` deflates them, so an images → PDF job keeps every image's pixels
 * alive at once. The sweep in `docs/router/memory-budget-measurement.md` runs
 * the same flat PNG at one, three, six, twelve and twenty-four images; 8 is the
 * rate at which the predicted cost first covers the measured peak everywhere
 * that peak reaches the smallest platform budget. Twelve of them measure 202 MB
 * against an iPhone's 90 MB, and this is what refuses them.
 *
 * JPEG is charged nothing, and that is not an oversight: `embedJpg` scans to
 * SOF0 and copies the bytes into a `DCTDecode` stream without running a Huffman
 * decoder, which is why `images-jpg-24` carries 288 Mpx and still peaks at 1.7×
 * its bytes. Those bytes the router already budgets.
 */
export const PDFLIB_DECODED_BYTES_PER_PIXEL = 8

/**
 * What one decoded pixel costs an engine that decodes through a browser bitmap.
 *
 * Structural rather than measured — `createImageBitmap` and `OffscreenCanvas`
 * have no Node stand-in, which is the same reason `MEMORY.canvas`, `.vips` and
 * `.heif` are unmeasured. Four bytes for the RGBA pixels and four for the canvas
 * backing store they are drawn onto, both live at the same moment: in
 * `./canvas-runner` between `decode()` and `bitmap.close()`, and in `./heif`
 * between `decodeHeif`'s `Uint8ClampedArray(width * height * 4)` and the
 * `OffscreenCanvas` `./bitmap` encodes it through.
 *
 * That it equals {@link PDFLIB_DECODED_BYTES_PER_PIXEL} is a coincidence of two
 * different allocations, not one number used twice — they are separate so that
 * re-measuring either cannot silently move the other.
 */
export const BITMAP_DECODED_BYTES_PER_PIXEL = 8

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG_SIGNATURE = Uint8Array.of(0xff, 0xd8, 0xff)

/** Byte offset of the IHDR width field: 8 of signature, 4 of length, 4 of type. */
const IHDR_WIDTH_OFFSET = 16
const IHDR_MIN_LENGTH = IHDR_WIDTH_OFFSET + 8

const MEGAPIXEL = 1_000_000
const MB = 1024 * 1024

/**
 * The dimensions in a PNG's IHDR, or `null` if this is not a PNG whose header
 * can be trusted.
 *
 * IHDR is required by the spec to be the *first* chunk, so its position is
 * fixed and no chunk walk is needed. `null` rather than a throw: the caller
 * already has a better error for "this is not an image", and a guard that
 * cannot read a size must not be the thing that refuses the file.
 */
export function pngSize(bytes: Uint8Array): ImageSize | null {
  if (!startsWith(bytes, PNG_SIGNATURE) || bytes.length < IHDR_MIN_LENGTH) return null
  if (!isChunkType(bytes, 12, 'IHDR')) return null

  const fields = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)

  return sizeOf(fields.getUint32(IHDR_WIDTH_OFFSET), fields.getUint32(IHDR_WIDTH_OFFSET + 4))
}

/**
 * The dimensions in a JPEG's start-of-frame segment, or `null`.
 *
 * Walks the marker chain rather than assuming an offset: a camera file opens
 * with APP0/APP1 (JFIF, Exif) and can carry a colour profile split across a
 * dozen APP2 segments before the frame header arrives. The walk stops at SOS,
 * after which the bytes are entropy-coded and `0xFF` no longer introduces a
 * marker.
 */
export function jpegSize(bytes: Uint8Array): ImageSize | null {
  if (!startsWith(bytes, JPEG_SIGNATURE)) return null

  const fields = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  let at = 2

  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) return null

    // Any number of 0xFF bytes may pad the gap before a marker code (JPEG, B.1.1.3).
    const code = bytes[at + 1]
    if (code === 0xff) {
      at += 1
      continue
    }

    // Standalone markers carry no length: TEM and the eight restart markers.
    if (code === 0x01 || (code >= 0xd0 && code <= 0xd7)) {
      at += 2
      continue
    }

    // SOS begins the entropy-coded data; EOI ends the image. Either way there is
    // no frame header left to find.
    if (code === 0xda || code === 0xd9) return null

    const length = fields.getUint16(at + 2)
    if (length < 2) return null

    if (isStartOfFrame(code)) {
      // Segment length, one byte of sample precision, then height before width.
      if (at + 9 > bytes.length) return null

      return sizeOf(fields.getUint16(at + 7), fields.getUint16(at + 5))
    }

    at += 2 + length
  }

  return null
}

/**
 * The dimensions of whichever of the two formats these bytes actually are.
 *
 * Sniffed, never taken from the file name: `descriptor.supports()` gates on
 * `task.from`, which is derived from the extension, so a JPEG called `.png`
 * reaches an engine claiming to be a PNG.
 */
export function rasterSize(bytes: Uint8Array): ImageSize | null {
  return pngSize(bytes) ?? jpegSize(bytes)
}

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
 * not an estimate.
 */
export function maxDecodedPixels(
  bytesPerPixel: number,
  budgetBytes: number = CONSERVATIVE_BUDGET_BYTES,
): number {
  return Math.max(0, Math.floor(budgetBytes / bytesPerPixel))
}

/** One image's contribution to a job, and the ceiling it is measured against. */
export interface DecodedPixelCheck {
  /** How the image is referred to in the rejection — quoted name, or position. */
  label: string
  /** The dimensions read from the header, before anything is decoded. */
  size: ImageSize
  /**
   * Decoded pixels the job reaches *including* this image. Omit for an engine
   * that decodes one file at a time and releases it before the next.
   */
  jobPixels?: number
  bytesPerPixel: number
  /** From `budgetBytes(caps)` where it is known; conservative where it is not. */
  budgetBytes?: number
}

/**
 * Refuses a job whose decoded pixels cannot fit the budget.
 *
 * Synchronous and called before the decoder is handed anything, which is the
 * whole point: by the time an out-of-memory shows up as a failed allocation the
 * tab is usually already gone. Inclusive of the limit, like `fitsInBudget`.
 *
 * The message names the file, its dimensions and the ceiling in the same unit
 * (CLAUDE.md §2.5), and the suggestion differs by case because the fix does: one
 * enormous image is resized, a long batch of ordinary ones is split up.
 */
export function assertDecodedPixelsFit(check: DecodedPixelCheck): void {
  const { label, size, bytesPerPixel, budgetBytes = CONSERVATIVE_BUDGET_BYTES } = check
  const ownPixels = size.width * size.height
  const jobPixels = check.jobPixels ?? ownPixels
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
        'fewer images at a time, or resize them first.',
    )
  }

  throw new Error(
    `${dimensions}, which is ${megapixels(ownPixels)} megapixels and more than this device ` +
      `can decode at once — ${ceiling}. Resize it below ${square(limit)} first, then ` +
      'convert it.',
  )
}

/** One decimal place: the number is an order-of-magnitude fact, not a budget line. */
function megapixels(pixels: number): string {
  return (pixels / MEGAPIXEL).toFixed(1)
}

/**
 * The limit expressed as a square, which is the only shape that can be quoted
 * without knowing the user's aspect ratio. Rounded down to 10 px so it reads as
 * guidance rather than as a threshold to hit exactly.
 */
function square(limitPixels: number): string {
  const side = Math.floor(Math.sqrt(limitPixels) / 10) * 10

  return `${side} × ${side} pixels`
}

/** Positive integers only — a zero or absurd dimension is a header we cannot use. */
function sizeOf(width: number, height: number): ImageSize | null {
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null
  if (width <= 0 || height <= 0) return null

  return { width, height }
}

function isStartOfFrame(code: number): boolean {
  // SOF0..SOF15, minus the three markers that share the range but are not
  // frame headers: DHT (0xC4), JPG (0xC8) and DAC (0xCC).
  return code >= 0xc0 && code <= 0xcf && code !== 0xc4 && code !== 0xc8 && code !== 0xcc
}

function isChunkType(bytes: Uint8Array, at: number, type: string): boolean {
  return [...type].every((character, index) => bytes[at + index] === character.charCodeAt(0))
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}
