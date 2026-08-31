/**
 * The heavy half of the canvas engine — heavy in role, not in bytes.
 *
 * It is reached only through `await import()` from `lib/engines/canvas.ts`, and
 * only inside the conversion worker: `OffscreenCanvas` and `createImageBitmap`
 * are the two APIs a worker has instead of a DOM canvas, and neither exists on
 * the server. Keeping it out of `canvas.ts` is what stops the encoder and the
 * BMP writer from riding into every page's bundle behind the registry's static
 * import of the descriptor (CLAUDE.md §2.3).
 *
 * The pipeline is three steps: decode the file to a bitmap, draw the bitmap onto
 * a canvas, ask the canvas for the target format. Only the third step differs by
 * format, and only BMP takes the hand-written path — see `./bmp`.
 *
 * SVG joins at the first step rather than forking the pipeline. A drawing has no
 * intrinsic pixel size, so the resolution has to be chosen and written into the
 * file before a decoder will honour it; `./canvas-svg` does that and hands back
 * an ordinary `Blob` this runner decodes like any other.
 *
 * Both browser APIs arrive as an injected {@link CanvasEnvironment} rather than
 * being read off `globalThis` at the call site. That is what lets the whole
 * choreography — the draw order, the bitmap teardown, every cancellation point —
 * be tested headlessly, in the same spirit as `Capabilities` being a parameter
 * to the router.
 */

import { throwIfAborted } from '@/lib/abort'
import type { FormatId } from '@/lib/router/types'

import { encodeBmp } from './bmp'
import { prepareSvg } from './canvas-svg'
import { type ImageOptions, resolveQuality } from './image-options'
import { assertBitmapFits, imageLabel } from './raster-limits'
import { rasterSize } from './raster-size'
import type { EngineInput, EngineRunner, ProgressCallback } from './types'

/** The formats a browser canvas can both read and write. */
const MIME_TYPES = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
} as const satisfies Partial<Record<FormatId, string>>

type CanvasFormat = keyof typeof MIME_TYPES

/**
 * Formats that carry an alpha channel. Everything else gets a white background
 * painted under it first — a JPEG cannot store transparency, and a canvas left
 * to itself composites those pixels onto black, which turns a logo on a
 * transparent background into a logo on a black card.
 */
const KEEPS_ALPHA: ReadonlySet<CanvasFormat> = new Set<CanvasFormat>(['png', 'webp', 'bmp'])

/**
 * What gets painted under a format that cannot carry alpha.
 *
 * A CSS colour keyword rather than a hex literal, and rather than a token: this
 * is a canvas fill that ends up in the file the user downloads, so the `@theme`
 * palette in `app/globals.css` has no say over it, and the design gate is right
 * to refuse a hex it cannot tell apart from a UI colour. White is what every
 * other converter mattes to and what a user expects from "save as JPEG".
 */
export const BACKDROP = 'white'

/**
 * libvips' 1..100 quality scale expressed the way `convertToBlob` wants it.
 *
 * The scale conversion is the whole reason this constant exists: the shared
 * default and the user's slider both live in `./image-options`, on the scale
 * libvips and every command-line encoder use, and a canvas takes a `0..1`
 * fraction instead. Keeping the default there rather than here is what makes a
 * JPEG produced by this engine comparable to one produced by wasm-vips —
 * routing picks between them for the same pair, and a browser's own `toBlob`
 * default of 0.92 made the Canvas output visibly the larger of the two.
 */
const QUALITY_SCALE = 100

/**
 * Progress checkpoints.
 *
 * A canvas conversion is three opaque awaits, none of which reports anything
 * from inside, so progress is genuinely stepwise rather than smooth. That is
 * honest here in a way it would not be for ffmpeg: the whole job is typically
 * under a second, so no step outlasts the 250 ms the contract allows.
 */
const DECODED = 0.4
const DRAWN = 0.7

/**
 * The two browser APIs the engine needs, injected so the runner can be tested
 * without them.
 */
export interface CanvasEnvironment {
  decode(source: Blob): Promise<ImageBitmap>
  createCanvas(width: number, height: number): OffscreenCanvas
}

/**
 * Binds the real browser APIs. Called at runner construction, not at module
 * load, so importing this module never touches a global.
 */
function browserEnvironment(): CanvasEnvironment {
  return {
    // `createImageBitmap` handles every format the browser can decode, BMP
    // included, so the read side needs no special cases at all.
    decode: (source) => createImageBitmap(source),
    createCanvas: (width, height) => new OffscreenCanvas(width, height),
  }
}

export function createCanvasRunner(
  environment: CanvasEnvironment = browserEnvironment(),
): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const target = targetFormat(input.task.to)
      const source = singleFile(input)
      const decodable = await prepareSource(input, source)
      // The read above is I/O, short but not free, and it sits between the
      // caller pressing cancel and anything else noticing.
      throwIfAborted(signal)
      onProgress(0)

      let bitmap: ImageBitmap | null = null

      try {
        bitmap = await environment.decode(decodable)
        throwIfAborted(signal)
        onProgress(DECODED)

        // Again, on what the decoder actually produced. The header sniff above
        // reads PNG, JPEG and WebP; a browser also decodes BMP, AVIF and, on
        // Apple hardware, HEIC, and the canvas about to be allocated is sized
        // from the bitmap rather than from anything the file declared.
        assertBitmapFits(imageLabel(source), bitmap)

        const canvas = environment.createCanvas(bitmap.width, bitmap.height)
        draw(canvas, bitmap, target)
        // Released as soon as it has been drawn rather than in the `finally`:
        // the encode below allocates a second full-size buffer, and holding the
        // decoded bitmap across it doubles the peak for no reason.
        bitmap.close()
        bitmap = null

        throwIfAborted(signal)
        onProgress(DRAWN)

        const output = await encode(canvas, target, input.image)
        throwIfAborted(signal)
        onProgress(1)

        return output
      } finally {
        bitmap?.close()
      }
    },
  }
}

/** Paints the backdrop where the target needs one, then draws the image over it. */
function draw(canvas: OffscreenCanvas, bitmap: ImageBitmap, target: CanvasFormat): void {
  const context = canvas.getContext('2d')
  if (context === null) {
    throw new Error('This browser would not give the conversion a 2d canvas context.')
  }

  if (!KEEPS_ALPHA.has(target)) {
    context.fillStyle = BACKDROP
    context.fillRect(0, 0, canvas.width, canvas.height)
  }

  context.drawImage(bitmap, 0, 0)
}

async function encode(
  canvas: OffscreenCanvas,
  target: CanvasFormat,
  options: ImageOptions | undefined,
): Promise<Blob> {
  const type = MIME_TYPES[target]

  if (target === 'bmp') {
    const context = canvas.getContext('2d')
    if (context === null) {
      throw new Error('This browser would not give the conversion a 2d canvas context.')
    }

    return new Blob([encodeBmp(context.getImageData(0, 0, canvas.width, canvas.height))], { type })
  }

  // Passed for every target, PNG included: `convertToBlob` ignores it for a
  // lossless type, and branching on which types are lossy here would fork a
  // table `./image-options` and `./vips-formats` already keep between them.
  const blob = await canvas.convertToBlob({
    type,
    quality: resolveQuality(options) / QUALITY_SCALE,
  })

  // `convertToBlob` is specified to fall back to PNG for a type it cannot
  // write, silently. Delivering a PNG named `.webp` is worse than failing: the
  // user keeps a file that half the world refuses to open.
  if (blob.type !== type) {
    throw new Error(
      `This browser cannot write ${type}: it produced ${blob.type || 'an unknown type'} instead.`,
    )
  }

  return blob
}

function targetFormat(format: FormatId): CanvasFormat {
  if (format in MIME_TYPES) return format as CanvasFormat

  throw new Error(`The canvas engine cannot write ${format.toUpperCase()} files.`)
}

/**
 * The `Blob` the decoder should actually be handed, and the refusal that goes
 * with it.
 *
 * Two shapes of source, one decode. A raster is passed through untouched after
 * its declared dimensions are checked; a drawing is rewritten to the resolution
 * the job asked for, and *that* size is what gets checked — a 24 px icon
 * rendered at 40 000 px is exactly as impossible as a 40 000 px photograph, and
 * the source file gives no hint of it.
 */
async function prepareSource(input: EngineInput, source: Blob): Promise<Blob> {
  if (input.task.from !== 'svg') {
    await refuseOversizedSource(source)

    return source
  }

  const prepared = await prepareSvg(source, input.image)
  assertBitmapFits(imageLabel(source), prepared.size)

  return prepared.source
}

/**
 * How much of a file has to be read to find its dimensions.
 *
 * A PNG's IHDR is the first chunk and lands inside 24 bytes. A JPEG's SOF0 sits
 * behind whatever APP segments the camera wrote — Exif, a thumbnail, an ICC
 * profile split across a dozen APP2 markers — and 64 kB clears all of those with
 * room to spare. Reading a slice rather than the whole file matters: `source`
 * can be a 200 MB image, and copying it here to look at its header would be a
 * second copy of the very thing this guard exists to bound.
 */
const HEADER_SLICE_BYTES = 65_536

/**
 * Refuses a source whose declared size no browser bitmap could hold, before one
 * is asked for.
 *
 * The best moment to stop is the one before `createImageBitmap` allocates
 * `width × height × 4`, because an out-of-memory inside a browser decoder is not
 * a catchable error on the platforms this protects — and a WebP or a PNG can
 * declare 20 000 × 20 000 in a file of a few hundred bytes.
 *
 * This is the *early* half of the guard, and it is allowed to abstain: a BMP, an
 * AVIF or a source whose header cannot be read is simply not refused here. The
 * check on the decoded bitmap in `run` is the one that always happens, one
 * allocation later.
 */
async function refuseOversizedSource(source: Blob): Promise<void> {
  const head = await headerOf(source)
  const size = head === null ? null : rasterSize(head)
  if (size === null) return

  assertBitmapFits(imageLabel(source), size)
}

/**
 * The first {@link HEADER_SLICE_BYTES} of `source`, or `null` if it has no
 * `slice` to give them with.
 *
 * A feature check rather than a `try`, deliberately. `Blob.slice` is universal
 * in a browser and in a worker, but `EngineInput` only promises a `Blob`, and a
 * value that has crossed a structured clone in a host with partial `Blob`
 * support arrives as data without methods — that is a source this cannot sniff,
 * and abstaining is right. A read that *fails* is a different thing: a
 * `NotReadableError` means the user moved or deleted the file after picking it,
 * which is more actionable than the decoder failure that would replace it, so it
 * is left to propagate.
 */
async function headerOf(source: Blob): Promise<Uint8Array | null> {
  if (typeof source.slice !== 'function') return null

  return new Uint8Array(await source.slice(0, HEADER_SLICE_BYTES).arrayBuffer())
}

function singleFile(input: EngineInput): Blob {
  const [source, ...rest] = input.files
  if (source === undefined || rest.length > 0) {
    throw new Error(`A format conversion takes exactly one file; got ${input.files.length}.`)
  }

  return source
}
