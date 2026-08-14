/**
 * The libheif boundary: HEIC bytes in, an RGBA bitmap out.
 *
 * Everything that knows libheif exists lives here, and it is split from
 * `heif.ts` for two reasons. The `await import()` on the next-to-last function
 * in this file is the bundler's chunk boundary — the line that keeps 1.4 MB of
 * WASM out of every page that merely renders a format picker (CLAUDE.md §2.3) —
 * and putting it behind a named loader means the engine can be handed a fake
 * one and tested without a browser or a megabyte of binary.
 *
 * libheif *decodes*. There is no encoder in this build, so nothing here writes
 * a file; that is `./bitmap`'s job, and the engine composes the two.
 */

import type { RgbaBitmap } from './bitmap'
import { assertBitmapFits } from './raster-limits'

/**
 * What libheif hands to `display`'s callback: the buffer it was given, or `null`
 * when it could not render.
 *
 * Deliberately looser than `RgbaBitmap`. libheif's own types describe the buffer
 * as `ArrayBufferLike`, while `RgbaBitmap` pins it to `ArrayBuffer` so the
 * pixels can reach `ImageData` — and nothing here reads the result beyond
 * checking it against `null`, so the narrow type would buy a cast and nothing
 * else.
 */
export type HeifDisplayResult = { readonly data: Uint8ClampedArray } | null

/** One image inside a HEIC file. Mirrors the wrapper libheif-js adds in JS. */
export interface HeifImage {
  get_width(): number
  get_height(): number
  /** True for the image a gallery would show — not necessarily the first one. */
  is_primary(): boolean
  /** Renders into `target` and calls `done` asynchronously, or with `null`. */
  display(target: RgbaBitmap, done: (result: HeifDisplayResult) => void): void
  /** Releases the WASM-side handle behind this image. */
  free(): void
}

export interface HeifDecoder {
  /** Answers `[]` — rather than throwing — for input it cannot parse. */
  decode(data: Uint8Array): HeifImage[]
}

/** The slice of the libheif module Docify uses. */
export interface HeifModule {
  HeifDecoder: new () => HeifDecoder
}

/** How the engine gets hold of libheif. A parameter, so a test can supply one. */
export type HeifLoader = () => Promise<HeifModule>

/**
 * The instantiated module, shared by every job in this worker.
 *
 * Instantiating libheif allocates a WASM heap of its own; doing it per
 * conversion would leave one behind on every file and take the tab down after a
 * handful. A rejected attempt is *not* cached — a failed download must be
 * retryable, and a promise that rejected once rejects forever.
 */
let instantiated: Promise<HeifModule> | null = null

/**
 * Loads libheif, at most once per worker.
 *
 * The dynamic import is the whole point: a bundler cuts its chunk here, so the
 * binary is fetched when the user has already picked a HEIC file and the router
 * has already chosen this engine — never before.
 */
export function loadHeif(): Promise<HeifModule> {
  instantiated ??= instantiate().catch((error: unknown) => {
    instantiated = null
    throw error
  })

  return instantiated
}

async function instantiate(): Promise<HeifModule> {
  const { default: createLibheif } = await import('libheif-js/libheif-wasm/libheif-bundle.mjs')

  return await createLibheif()
}

/**
 * Decodes the primary image of a HEIC/HEIF file into RGBA pixels.
 *
 * Two things here are not obvious from libheif's own API. It reports a file it
 * cannot parse as an *empty array* rather than as an error, so the empty case
 * has to be turned into something the user can read. And `decode` returns every
 * image in the container — a burst, a Live Photo, a thumbnail pair — each
 * holding a WASM-side handle, so all of them are released even though only one
 * is rendered. Leaking the rest is how the tab dies on the fifth conversion.
 *
 * Synchronous inside libheif: the decode cannot be interrupted once it starts,
 * so cancellation is checked around this call rather than within it.
 *
 * `label` is how the image is named if it is refused — see `./raster-limits`.
 * The default reads as a sentence on its own, because a `Blob` carries no name
 * and there is nothing better to say about it.
 */
export async function decodeHeif(
  module: HeifModule,
  bytes: Uint8Array,
  label = 'This image',
): Promise<RgbaBitmap> {
  const images = new module.HeifDecoder().decode(bytes)

  if (images.length === 0) {
    throw new Error(
      'This file contains no image libheif could read. It may not be a HEIC or HEIF file, or it may be incomplete.',
    )
  }

  try {
    const image = primaryImage(images)
    const width = image.get_width()
    const height = image.get_height()

    if (!isPositiveInteger(width) || !isPositiveInteger(height)) {
      throw new Error(
        `This HEIC file reports impossible dimensions (${width} by ${height}), so it cannot be decoded.`,
      )
    }

    // The line below allocates `width × height × 4` and `./bitmap` then draws it
    // onto an `OffscreenCanvas` of the same size, so an image past what a canvas
    // can hold produces a blank file rather than an error. Checked here because
    // this is the last point before the first of those two allocations, and
    // because a HEIC's dimensions are not predicted by its bytes — the codec is
    // the whole point of the format — so `route()` cannot bound it.
    assertBitmapFits(label, { width, height })

    const bitmap: RgbaBitmap = { width, height, data: new Uint8ClampedArray(width * height * 4) }

    await new Promise<void>((resolve, reject) => {
      image.display(bitmap, (result) => {
        if (result === null) {
          reject(
            new Error(
              'This image could not be decoded. HEIC files that use an unsupported codec or are partly corrupt fail here.',
            ),
          )
          return
        }

        resolve()
      })
    })

    return bitmap
  } finally {
    for (const image of images) image.free()
  }
}

/**
 * The image a viewer would show, and the first top-level one when libheif
 * cannot say which that is.
 *
 * `is_primary()` is unusable in libheif-js 1.19.8. Its wrapper reads
 *
 *     Q.prototype.is_primary = function () {
 *       return !!heif_image_handle_is_primary_image(this.handle)
 *     }
 *
 * where every sibling goes through the module object — `r.heif_image_handle_-
 * get_width(this.handle)` — so the bare identifier resolves to nothing and the
 * call throws `ReferenceError`. The C function is exported, but only as the raw
 * `r._heif_image_handle_is_primary_image`, which is not part of the package's
 * supported surface and takes a handle this wrapper keeps to itself.
 *
 * So the capability is probed rather than assumed: the first throw ends the
 * search, and this starts selecting properly on its own if upstream fixes the
 * typo. Falling back to the first top-level image is right for every HEIC a
 * phone produces, which carries exactly one.
 */
function primaryImage(images: HeifImage[]): HeifImage {
  for (const candidate of images) {
    try {
      if (candidate.is_primary()) return candidate
    } catch {
      return images[0]
    }
  }

  return images[0]
}

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0
}
