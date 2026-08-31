/**
 * The encoding half of the wasm-vips engine: one source buffer in, one encoded
 * `Blob` out.
 *
 * Split from `./vips.ts` so that file stays the descriptor plus the module
 * lifecycle, and this one holds the pipeline. The split earns itself with the
 * target-size search below, which is a loop around everything the single-shot
 * path does and would otherwise have doubled the engine file (CLAUDE.md §5.2).
 *
 * Nothing here loads or owns a `VipsModule` — one arrives as a parameter, warm,
 * from the runner. That keeps every function testable against the fake module in
 * `test/engines/vips-fake.ts`, with no WASM and no browser.
 */

import { throwIfAborted } from '@/lib/abort'
import type { ConversionTask } from '@/lib/router/types'

import { type ImageOptions, resolveTargetBytes, wantsResize } from './image-options'
import { encodeToTargetSize, TARGET_SIZE_MAX_ATTEMPTS } from './image-target-size'
import type { ProgressCallback } from './types'
import { isLossyOutput, mimeType, saveOptions, saveSuffix } from './vips-formats'
import type { VipsImage, VipsModule } from './vips-runtime'

/**
 * Stands in for "no limit on this axis" when only one of width/height is given.
 *
 * libvips fits the image inside a width × height box, so the unconstrained axis
 * needs a number no real image reaches. libvips itself refuses dimensions above
 * roughly 65 500 px, so a million is unreachable by construction.
 */
const UNBOUNDED_DIMENSION = 1_000_000

/**
 * Encodes `bytes` into the task's target format, resizing and compressing as
 * the options ask.
 *
 * Two paths, chosen by whether the job named an output size:
 *
 * - **Single-shot.** One pipeline, one write. What every conversion and every
 *   quality-slider compression does.
 * - **Target size.** Encode, measure, adjust — see `./image-target-size`. Only
 *   for a lossy target: PNG and TIFF ignore quality, so there is no dial to
 *   search and repeating the encode eight times would produce eight identical
 *   files.
 */
export function encodeImage(
  module: VipsModule,
  bytes: Uint8Array,
  task: ConversionTask,
  options: ImageOptions | undefined,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Blob {
  // libvips reports percentages only once it can estimate the work, and the
  // whole pipeline runs inside one synchronous call. Indeterminate is the honest
  // opening state; real ticks overwrite it as soon as there are any.
  onProgress(-1)

  const target = resolveTargetBytes(options)

  const written =
    target !== undefined && isLossyOutput(task.to)
      ? searchForSize(module, bytes, task, options, target, signal, onProgress)
      : writeOnce(module, bytes, task, options, signal, (percent) =>
          onProgress(clampFraction(percent / 100)),
        )

  throwIfAborted(signal)
  onProgress(1)

  return new Blob([written], { type: mimeType(task.to) })
}

/**
 * Re-encodes at descending qualities until the output fits `targetBytes`.
 *
 * Every attempt opens the source again rather than re-writing one handle, which
 * is not an oversight: `access: 'sequential'` lets libvips stream an image in
 * scanline regions and read it exactly once, so a second write on the same image
 * fails. Re-opening pays a decode per attempt and keeps the streaming pipeline —
 * and with it the 4× expansion factor `MEMORY.vips` in `lib/router/budget.ts`
 * promises. Switching to `access: 'random'` would allow re-reads and would
 * materialise the whole bitmap, which is exactly the cost that model says this
 * engine does not pay.
 */
function searchForSize(
  module: VipsModule,
  bytes: Uint8Array,
  task: ConversionTask,
  options: ImageOptions | undefined,
  targetBytes: number,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Uint8Array<ArrayBuffer> {
  let attempt = 0

  const { output } = encodeToTargetSize(targetBytes, (quality) => {
    // Checked before the encode rather than only after: an attempt is a full
    // pass over a full-resolution image, and starting one the user has already
    // cancelled is the most expensive way to notice.
    throwIfAborted(signal)

    const written = writeOnce(module, bytes, task, { ...options, quality }, signal, (percent) =>
      // Each attempt owns one slice of the bar, so ticks climb across the whole
      // search instead of resetting to zero on every re-encode. The bar stops
      // short of 1 whenever the search ends early, which `encodeImage` closes.
      onProgress(
        clampFraction((attempt + clampFraction(percent / 100)) / TARGET_SIZE_MAX_ATTEMPTS),
      ),
    )

    attempt += 1

    return { output: written, bytes: written.length }
  })

  return output
}

/**
 * One complete pipeline: open, encode, release.
 *
 * The returned bytes are copied out of the WASM heap before the handle is
 * deleted — the view libvips hands back is backed by memory it is free to reuse,
 * and the next attempt of a target-size search reuses it immediately.
 */
function writeOnce(
  module: VipsModule,
  bytes: Uint8Array,
  task: ConversionTask,
  options: ImageOptions | undefined,
  signal: AbortSignal,
  onPercent: (percent: number) => void,
): Uint8Array<ArrayBuffer> {
  const image = open(module, bytes, options)
  const cancel = () => {
    // Checked by libvips between scanline regions, which is the only place a
    // synchronous WASM call can be interrupted from the outside.
    image.kill = true
  }

  try {
    image.onProgress = onPercent
    signal.addEventListener('abort', cancel, { once: true })

    const written = image.writeToBuffer(saveSuffix(task.to), saveOptions(task.to, options))

    // A killed pipeline returns whatever it had rather than throwing, so the
    // cancel is enforced here instead of trusted to libvips.
    throwIfAborted(signal)

    // Copied out of the WASM heap, and copied into a buffer of our own rather
    // than a view onto libvips': the memory behind `written` is libvips' to
    // reuse the moment the handle below is deleted, and the next attempt of a
    // target-size search reuses it immediately.
    const copy = new Uint8Array(written.byteLength)
    copy.set(written)

    return copy
  } finally {
    signal.removeEventListener('abort', cancel)
    // Embind handles are not garbage collected. Miss this and the WASM heap
    // grows by a full decoded image per conversion until the tab dies.
    image.delete()
  }
}

/**
 * Opens the source, resizing on the way in when a target size was asked for.
 *
 * `thumbnailBuffer` rather than a decode followed by `resize`, because it is the
 * whole reason this engine beats Canvas on quality *and* on memory: it shrinks
 * on load where the codec allows it (JPEG DCT scaling, WebP and AVIF thumbnail
 * scaling), reduces the remainder with a Lanczos-3 kernel, and premultiplies
 * alpha so edges do not darken. A decoded-then-resized 8000 px JPEG would hold
 * the full bitmap; this holds a few scanlines.
 */
function open(module: VipsModule, bytes: Uint8Array, options: ImageOptions | undefined): VipsImage {
  if (!wantsResize(options)) {
    // Sequential access lets libvips stream the image in scanline regions rather
    // than materialise it, which is what the router's 4× expansion factor
    // assumes (`MEMORY.vips` in `lib/router/budget.ts`).
    return module.Image.newFromBuffer(bytes, '', { access: 'sequential' })
  }

  return module.Image.thumbnailBuffer(bytes, options?.width ?? UNBOUNDED_DIMENSION, {
    height: options?.height ?? UNBOUNDED_DIMENSION,
    size: options?.enlarge === true ? 'both' : 'down',
  })
}

/** libvips can report slightly over 100, and reports nothing at all on failure. */
function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return -1

  return Math.min(Math.max(value, 0), 1)
}
