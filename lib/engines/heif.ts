/**
 * The HEIC engine: the one conversion iPhone owners come here for.
 *
 * libheif is a *decoder*. The build Docify ships has no encoder in it at all,
 * so this engine does exactly half a conversion — HEIC bytes to RGBA pixels —
 * and hands the other half to `./bitmap`, which writes the JPEG or PNG with the
 * browser's own `OffscreenCanvas`. That seam is a constructor parameter rather
 * than a hard-wired call, so the pixel path can later be pointed at the
 * `canvas` engine's encoder without this file changing, and so the glue can be
 * tested with no `OffscreenCanvas` and no WASM in scope.
 *
 * The two halves of the engine contract are split as `lib/engines/types.ts`
 * requires: `descriptor` is a handful of numbers and a predicate, imported
 * statically by the registry and therefore by every page; `createRunner`
 * reaches libheif through `./heif-decode`, whose `await import()` is where the
 * bundler cuts the chunk (CLAUDE.md §2.3).
 *
 * `MEMORY.heif` in `lib/router/budget.ts` is `holds: 'one-at-a-time'`: a photo
 * library dropped on the converter is decoded image by image, so what has to
 * fit is the largest of them rather than the whole camera roll.
 */

import { throwIfAborted } from '@/lib/abort'
import type { BitmapEncoder } from './bitmap'
import { encodeBitmap } from './bitmap'
import type { HeifLoader, HeifModule } from './heif-decode'
import { decodeHeif, loadHeif } from './heif-decode'
import { imageLabel } from './raster-limits'
import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'
import type { Capabilities, ConversionTask, FormatId } from '@/lib/router/types'

/**
 * Download size of `libheif-wasm/libheif-bundle.mjs`: 1 462 173 bytes measured,
 * rounded up for the engine's own glue chunk.
 *
 * Comfortably under `LARGE_DOWNLOAD_BYTES`, so the router does not warn about
 * it — which is the right call for a one-time fetch of this size on the app's
 * single most requested conversion.
 */
export const HEIF_LOAD_COST = 1_470_000

/**
 * The share of the job the decode accounts for.
 *
 * Neither half reports its own progress — libheif decodes inside one
 * uninterruptible WASM call and `convertToBlob` is opaque — so this engine
 * reports two steps rather than a smooth curve. 0.7 is roughly where the time
 * goes: entropy decoding a full-resolution HEVC tile costs more than the PNG or
 * JPEG write that follows it. The worker's progress relay fills the silence in
 * between, so the bar never looks frozen.
 */
export const DECODE_SHARE = 0.7

/** What this engine can write. libheif reads HEIC; the canvas writes these. */
const OUTPUT_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>(['jpg', 'png'])

export const descriptor: EngineDescriptor = {
  id: 'heif',
  label: 'HEIC decoder (libheif)',
  loadCost: HEIF_LOAD_COST,
  priority: 35,
  supports,
}

/**
 * Decided from the task and the device only, and never from the file.
 *
 * `offscreenCanvas` is a real gate rather than a formality: this engine has no
 * encoder of its own, so without a canvas to write through it can decode a HEIC
 * and then produce nothing. `wasmSimd` is deliberately *not* required — the
 * libheif build we ship is baseline wasm32, and demanding SIMD would refuse the
 * conversion on browsers that can run it perfectly well.
 */
function supports(task: ConversionTask, caps: Capabilities): boolean {
  return (
    task.op === 'convert' &&
    task.from === 'heic' &&
    OUTPUT_FORMATS.has(task.to) &&
    caps.offscreenCanvas
  )
}

/** The seams a test replaces; production supplies neither. */
export interface HeifRunnerOptions {
  load?: HeifLoader
  encode?: BitmapEncoder
}

/**
 * Builds a runner, loading libheif in the process.
 *
 * Loading here rather than inside `run` is what makes a cancel during the
 * download work: `lib/worker/api.ts` checks the abort signal immediately after
 * awaiting the runner, which is the window in which a user is most likely to
 * change their mind.
 */
export async function createRunner(options: HeifRunnerOptions = {}): Promise<EngineRunner> {
  const { load = loadHeif, encode = encodeBitmap } = options
  const libheif = await load()

  return { run: (input, signal, onProgress) => run(libheif, encode, input, signal, onProgress) }
}

async function run(
  libheif: HeifModule,
  encode: BitmapEncoder,
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Promise<Blob> {
  throwIfAborted(signal)

  const file = onlyFile(input)
  const bytes = new Uint8Array(await file.arrayBuffer())
  throwIfAborted(signal)

  const bitmap = await decodeHeif(libheif, bytes, imageLabel(file))
  onProgress(DECODE_SHARE)

  // The decode above cannot be interrupted from outside — it is one synchronous
  // call into WASM — so this is the first moment a cancel can be honoured, and
  // encoding anyway would hand back a file the user already said no to.
  throwIfAborted(signal)

  const blob = await encode(bitmap, input.task.to)
  onProgress(1)

  return blob
}

/**
 * The single file this engine converts.
 *
 * A second file is refused rather than ignored: silently converting the first
 * of two would hand the user one output and no explanation of where the other
 * went.
 */
function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Converting a HEIC file takes exactly one file, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
