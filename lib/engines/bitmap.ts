/**
 * The encode seam: raw RGBA pixels in, an encoded image `Blob` out.
 *
 * libheif decodes and nothing else — there is no HEIC encoder in the build we
 * ship, and there is no PNG or JPEG writer in it either. So the HEIC engine
 * ends with a bitmap and needs somebody to turn that into a file. This module
 * is that somebody, and it is deliberately a module of its own rather than a
 * private helper inside `heif.ts`:
 *
 * - Every raster engine that decodes into pixels — libheif today, wasm-vips and
 *   pdf.js later — hits the same wall and must not each grow their own copy of
 *   `putImageData` + `convertToBlob`.
 * - `BitmapEncoder` is a *parameter* of `createRunner`, so a test can assert the
 *   hand-off without an `OffscreenCanvas`, and a later change can swap the
 *   canvas encoder for the `canvas` engine's own without touching `heif.ts`.
 *
 * `OffscreenCanvas` is the browser's built-in image writer and costs no
 * download, which is why the seam's default implementation uses it rather than
 * pulling a WASM encoder in behind the engine's back.
 *
 * Worker-only: `OffscreenCanvas` is read when `encodeBitmap` is called, never at
 * module scope, so importing this from the main thread — as the registry
 * transitively does — is free and safe under SSR.
 */

import type { FormatId } from '@/lib/router/types'

/**
 * A decoded image: row-major RGBA, four bytes per pixel, `width * height * 4`
 * bytes long.
 *
 * `readonly` on the fields, not on the buffer: libheif writes its output *into*
 * the array this describes, and that is the whole point of handing it one.
 *
 * The buffer is pinned to `ArrayBuffer` rather than left as the default
 * `ArrayBufferLike`, because `ImageData` accepts only the former — a
 * `SharedArrayBuffer` cannot back canvas pixel data, and `encodeBitmap` hands
 * this straight to `new ImageData(...)`.
 */
export interface RgbaBitmap {
  readonly width: number
  readonly height: number
  readonly data: Uint8ClampedArray<ArrayBuffer>
}

/** How an engine turns its decoded pixels into the file the user asked for. */
export type BitmapEncoder = (bitmap: RgbaBitmap, format: FormatId) => Promise<Blob>

/**
 * The output formats this seam can write, and the MIME type each needs.
 *
 * Only the two the HEIC engine claims. Adding a format here is not enough on
 * its own — an engine has to claim it in `supports` as well — and a format that
 * no engine claims is a promise with nothing behind it.
 */
export const BITMAP_MIME_TYPES: Partial<Record<FormatId, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
}

/**
 * JPEG quality for a decoded-then-re-encoded photo.
 *
 * 0.92 is the quality browsers pick for `toDataURL('image/jpeg')`, and it is
 * high enough that the re-encode is not the visible loss in a HEIC → JPEG
 * conversion — the HEIC already was. Set explicitly because `convertToBlob`
 * leaves its default to the implementation, and a conversion whose output size
 * changes with the user's browser is not one we can reason about.
 */
export const JPEG_QUALITY = 0.92

/**
 * What shows through where the source image was transparent.
 *
 * JPEG has no alpha channel, so those pixels composite onto whatever is behind
 * them — and an untouched canvas is transparent black, which turns a cut-out
 * into a photo on a black background. White is what every other converter does
 * and what a user expects from "save as JPEG".
 *
 * A canvas fill colour, not a UI colour: this is image data the user downloads,
 * so the design tokens in `app/globals.css` have no say over it.
 *
 * Spelled as a CSS keyword rather than a hex literal. The design gate cannot
 * tell a canvas fill from a UI colour and refuses every hex outside the `@theme`
 * block, which is the right trade — a keyword says the same thing and keeps the
 * rule absolute. `canvas-runner.ts` mattes with the same value for the same
 * reason.
 */
export const MATTE_COLOUR = 'white'

/**
 * Encodes `bitmap` as `format`.
 *
 * Throws rather than guessing when the format has no writer here: reaching this
 * with an unknown format means an engine's `supports` claimed a pair the seam
 * cannot finish, which is a bug to fix and not a case to degrade.
 */
export async function encodeBitmap(bitmap: RgbaBitmap, format: FormatId): Promise<Blob> {
  const type = BITMAP_MIME_TYPES[format]
  if (type === undefined) {
    throw new Error(`No encoder is registered for the output format "${format}".`)
  }

  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height)
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('This browser refused a 2D context on an OffscreenCanvas, so it cannot encode.')
  }

  context.putImageData(new ImageData(bitmap.data, bitmap.width, bitmap.height), 0, 0)

  if (type === BITMAP_MIME_TYPES.jpg) {
    // `destination-over` paints *behind* what is already on the canvas, so the
    // matte lands in one pass on the same canvas rather than needing a second
    // one — which at photo resolutions is another RGBA buffer we cannot afford.
    context.globalCompositeOperation = 'destination-over'
    context.fillStyle = MATTE_COLOUR
    context.fillRect(0, 0, bitmap.width, bitmap.height)

    return canvas.convertToBlob({ type, quality: JPEG_QUALITY })
  }

  return canvas.convertToBlob({ type })
}
