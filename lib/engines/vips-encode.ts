/**
 * The encoding half of the wasm-vips engine: one source buffer in, one encoded
 * `Blob` out.
 *
 * Split from `./vips.ts` so that file stays the descriptor plus the module
 * lifecycle, and this one holds the job. The split earns itself with the
 * target-size search below, which is a loop around everything the single-shot
 * path does and would otherwise have doubled the engine file (CLAUDE.md §5.2).
 * The pipeline the loop runs lives one file further out, in `./vips-pipeline`.
 *
 * Nothing here loads or owns a `VipsModule` — one arrives as a parameter, warm,
 * from the runner. That keeps every function testable against the fake module in
 * `test/engines/vips-fake.ts`, with no WASM and no browser.
 */

import { throwIfAborted } from '@/lib/abort'
import type { ConversionTask } from '@/lib/router/types'

import { type GeometryPlan, planGeometry } from './image-geometry'
import { type ImageOptions, resolveTargetBytes } from './image-options'
import { encodeToTargetSize, TARGET_SIZE_MAX_ATTEMPTS } from './image-target-size'
import type { ImageSize } from './raster-size'
import type { ProgressCallback } from './types'
import { isLossyOutput, mimeType, saveOptions, saveSuffix } from './vips-formats'
import { assertPipelineFits, openPlanned, sourceSize } from './vips-pipeline'
import type { VipsImage, VipsModule } from './vips-runtime'

/** One job, as everything below needs to see it. */
export interface EncodeRequest {
  /** A module already warmed up by the runner, with the side modules this job needs. */
  module: VipsModule
  bytes: Uint8Array
  task: ConversionTask
  options: ImageOptions | undefined
  /** How the source is named in a refusal — `imageLabel()` from `./raster-limits`. */
  label: string
  /** `EngineInput.budgetBytes`: what the device that routed this job may spend. */
  budgetBytes: number | undefined
  signal: AbortSignal
  onProgress: ProgressCallback
}

/**
 * Encodes the source into the task's target format, applying every geometry
 * change the options ask for on the way.
 *
 * Two encoding paths, chosen by whether the job named an output size:
 *
 * - **Single-shot.** One pipeline, one write. What every conversion, every
 *   quality-slider compression and every crop or rotate does.
 * - **Target size.** Encode, measure, adjust — see `./image-target-size`. Only
 *   for a lossy target: PNG and TIFF ignore quality, so there is no dial to
 *   search and repeating the encode eight times would produce eight identical
 *   files.
 *
 * The geometry is planned once, before either path, because it is a function of
 * the source and the settings and not of the quality being tried. Planning it
 * per attempt would re-clamp the crop rect eight times for one answer.
 */
export function encodeImage(request: EncodeRequest): Blob {
  const { task, signal, onProgress } = request

  // libvips reports percentages only once it can estimate the work, and the
  // whole pipeline runs inside one synchronous call. Indeterminate is the honest
  // opening state; real ticks overwrite it as soon as there are any.
  onProgress(-1)

  const job = planJob(request)
  const target = resolveTargetBytes(request.options)

  const written =
    target !== undefined && isLossyOutput(task.to)
      ? searchForSize(request, job, target)
      : writeOnce(request, job, request.options, (percent) =>
          onProgress(clampFraction(percent / 100)),
        )

  throwIfAborted(signal)
  onProgress(1)

  return new Blob([written], { type: mimeType(task.to) })
}

/** A job's geometry, decided once: the source it was measured against and the plan. */
interface PlannedJob {
  source: ImageSize
  plan: GeometryPlan
}

/**
 * Reads the source's dimensions, plans the geometry against them, and refuses
 * the job if that plan will not fit in memory.
 *
 * The probe handle is opened and released here rather than reused by the
 * pipeline, because the pipeline's own access mode depends on the plan this
 * produces. The probe is a lazy header parse — `newFromBuffer` works out the
 * geometry without touching a pixel — so it costs nothing a decode would notice,
 * and doing it once rather than per encode is what keeps a target-size search to
 * one open per attempt.
 */
function planJob(request: EncodeRequest): PlannedJob {
  const { module, bytes, options, label, budgetBytes } = request
  const handles: VipsImage[] = []

  try {
    const source = sourceSize(module, bytes, keeper(handles))
    const plan = planGeometry(options, source)
    assertPipelineFits(plan, source, label, budgetBytes)

    return { source, plan }
  } finally {
    release(handles)
  }
}

/**
 * Re-encodes at descending qualities until the output fits `targetBytes`.
 *
 * Every attempt opens the source again rather than re-writing one handle, which
 * is not an oversight: `access: 'sequential'` lets libvips stream an image in
 * scanline regions and read it exactly once, so a second write on the same image
 * fails. Re-opening pays a decode per attempt and keeps the streaming pipeline —
 * and with it the 4× expansion factor `MEMORY.vips` in `lib/router/budget.ts`
 * promises. Switching to `access: 'random'` for the sake of re-reads would
 * materialise the whole bitmap, which is exactly the cost that model says an
 * ordinary job does not pay.
 */
function searchForSize(
  request: EncodeRequest,
  job: PlannedJob,
  targetBytes: number,
): Uint8Array<ArrayBuffer> {
  const { options, signal, onProgress } = request
  let attempt = 0

  const { output } = encodeToTargetSize(targetBytes, (quality) => {
    // Checked before the encode rather than only after: an attempt is a full
    // pass over a full-resolution image, and starting one the user has already
    // cancelled is the most expensive way to notice.
    throwIfAborted(signal)

    const written = writeOnce(request, job, { ...options, quality }, (percent) =>
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
 * One complete pipeline: open, transform, encode, release.
 *
 * `options` is a parameter rather than read off `request` because the target-size
 * search substitutes a quality into it per attempt, while everything else about
 * the job — the geometry included, which is already planned — stays fixed.
 */
function writeOnce(
  request: EncodeRequest,
  job: PlannedJob,
  options: ImageOptions | undefined,
  onPercent: (percent: number) => void,
): Uint8Array<ArrayBuffer> {
  const { module, bytes, task, signal } = request
  const handles: VipsImage[] = []
  // Every libvips operation returns a fresh handle, so a multi-stage pipeline's
  // intermediates have to be tracked; only the last one is written from.
  const keep = keeper(handles)

  const cancel = () => {
    // Checked by libvips between scanline regions, which is the only place a
    // synchronous WASM call can be interrupted from the outside. Set on every
    // stage, because which of them is evaluating when the user clicks cancel is
    // not knowable from here.
    for (const image of handles) image.kill = true
  }

  try {
    signal.addEventListener('abort', cancel, { once: true })

    const image = openPlanned(module, bytes, job.plan, job.source, keep, signal)
    image.onProgress = onPercent

    const written = image.writeToBuffer(saveSuffix(task.to), saveOptions(task.to, options))

    // A killed pipeline returns whatever it had rather than throwing, so the
    // cancel is enforced here instead of trusted to libvips.
    throwIfAborted(signal)

    // Copied out of the WASM heap, and into a buffer of our own rather than a
    // view onto libvips': the memory behind `written` is libvips' to reuse the
    // moment the handles below are deleted, and the next attempt of a
    // target-size search reuses it immediately.
    const copy = new Uint8Array(written.byteLength)
    copy.set(written)

    return copy
  } finally {
    signal.removeEventListener('abort', cancel)
    release(handles)
  }
}

function keeper(handles: VipsImage[]) {
  return (image: VipsImage): VipsImage => {
    handles.push(image)

    return image
  }
}

/**
 * Releases every handle the pipeline made.
 *
 * Embind handles are not garbage collected. Miss one and the WASM heap grows by
 * a full image per conversion until the tab dies — and a five-stage pipeline
 * leaks four of them, not one.
 */
function release(handles: readonly VipsImage[]): void {
  for (const image of handles) image.delete()
}

/** libvips can report slightly over 100, and reports nothing at all on failure. */
function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return -1

  return Math.min(Math.max(value, 0), 1)
}
