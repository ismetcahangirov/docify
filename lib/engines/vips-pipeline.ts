/**
 * Building one libvips pipeline out of a {@link GeometryPlan}.
 *
 * Every libvips operation returns a *new* image handle rather than mutating the
 * one it was called on, and Embind handles are not garbage collected. A five-step
 * pipeline therefore leaks four full images unless something keeps the
 * intermediates and releases them — which is what `handles` is for, and why every
 * function here takes one instead of allocating privately.
 *
 * Split from `./vips-encode` because the two answer different questions: that
 * module decides *how many times* to encode, this one decides *what the pipeline
 * is*. Neither is large on its own and together they would be past the size rule
 * (CLAUDE.md §5.2).
 */

import { throwIfAborted } from '@/lib/abort'

import { type GeometryPlan, needsWholeImage, type ResizePlan, resizedSize } from './image-geometry'
import { assertDecodedPixelsFit } from './raster-limits'
import type { ImageSize } from './raster-size'
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
 * What a pixel costs while libvips holds a whole image in memory.
 *
 * Arithmetic rather than a measurement, and stated as such — the same footing as
 * `MEMORY.heif`'s per-pixel term in `lib/router/budget.ts`. A random-access
 * libvips image is uncompressed bands: four for RGBA, at one byte each. A
 * rotation writes its result into a second buffer of the same size while the
 * source is still live, so both are charged: 4 + 4.
 *
 * It over-charges an opaque RGB source by two bytes a pixel, which is the safe
 * direction for a ceiling whose failure mode is a killed tab.
 */
export const VIPS_WHOLE_IMAGE_BYTES_PER_PIXEL = 8

/** libvips' spelling of the angles {@link GeometryPlan.rotate} allows. */
const ROTATIONS: Readonly<Record<number, string>> = { 90: 'd90', 180: 'd180', 270: 'd270' }

/** Collects handles so the caller can release every one of them, in order. */
export type HandleSink = (image: VipsImage) => VipsImage

/**
 * The source's dimensions, read without decoding it.
 *
 * `newFromBuffer` is lazy: it parses the header, works out the geometry and
 * hands back a pipeline that has not touched a pixel. That makes this cheap
 * enough to do unconditionally, which matters because *everything* about the
 * plan depends on it — a crop rect is meaningless without the picture it cuts,
 * and a resize to the size the image already is should not cost a scaler pass.
 */
export function sourceSize(module: VipsModule, bytes: Uint8Array, keep: HandleSink): ImageSize {
  const probe = keep(module.Image.newFromBuffer(bytes, '', { access: 'sequential' }))

  return { width: probe.width, height: probe.height }
}

/**
 * Refuses a job whose pipeline would have to hold the whole image, on a device
 * that cannot hold it.
 *
 * This is the ceiling `lib/engines/vips.ts` said would "come back" if an
 * operation ever forced a random-access pipeline. Rotating and flipping are that
 * operation: both read the source bottom-up, so the scanline streaming the rest
 * of the engine relies on — and that `MEMORY.vips` prices at 4× the *encoded*
 * bytes with nothing per pixel — is not available for them. A 200 megapixel scan
 * compresses to a few megabytes and passes the router's byte check comfortably;
 * turning it 90° needs 1.6 GB.
 *
 * Only for the jobs that need it. A crop or a resize still streams, and applying
 * a pixel ceiling to those would refuse work this engine finishes in a few
 * hundred kilobytes.
 */
export function assertPipelineFits(
  plan: GeometryPlan,
  source: ImageSize,
  label: string,
  budgetBytes: number | undefined,
): void {
  if (!needsWholeImage(plan)) return

  assertDecodedPixelsFit({
    label,
    size: source,
    bytesPerPixel: VIPS_WHOLE_IMAGE_BYTES_PER_PIXEL,
    budgetBytes,
  })
}

/**
 * Opens the source and applies `plan` to it, in order.
 *
 * Two ways in, and which one is taken is the difference between shrinking a
 * JPEG inside its own decoder and decoding it whole first:
 *
 * - **Resize alone** goes through `thumbnailBuffer`, which shrinks on load where
 *   the codec allows it (JPEG DCT scaling, WebP and AVIF thumbnail scaling) and
 *   reduces the remainder with Lanczos-3. An 8000 px JPEG never exists at full
 *   size. This is the path almost every job takes.
 * - **Anything else** has to see the image first — a crop rect is in source
 *   coordinates and a rotation needs rows the shrink-on-load path has already
 *   thrown away — so it opens the buffer and scales by hand. Same kernel, one
 *   decode more.
 *
 * Access mode follows the plan rather than the format: sequential wherever the
 * pipeline reads forwards, random for the rotations and flips that do not. That
 * is the whole reason {@link assertPipelineFits} exists.
 */
export function openPlanned(
  module: VipsModule,
  bytes: Uint8Array,
  plan: GeometryPlan,
  source: ImageSize,
  keep: HandleSink,
  signal: AbortSignal,
): VipsImage {
  if (plan.crop === null && plan.rotate === 0 && plan.flip === null) {
    return keep(thumbnail(module, bytes, plan.resize))
  }

  const access = needsWholeImage(plan) ? 'random' : 'sequential'
  let image = keep(module.Image.newFromBuffer(bytes, '', { access }))
  let size = source

  if (plan.crop !== null) {
    const { left, top, width, height } = plan.crop
    image = keep(image.extractArea(left, top, width, height))
    size = { width, height }
  }

  if (plan.resize !== null) {
    const target = resizedSize(plan.resize, size)
    image = keep(image.resize(target.width / size.width, { vscale: target.height / size.height }))
    size = target
  }

  // Between operations rather than only around them: each of these evaluates
  // eagerly enough on a large image to outlast a click on cancel.
  throwIfAborted(signal)

  if (plan.rotate !== 0) image = keep(image.rot(ROTATIONS[plan.rotate]))
  if (plan.flip !== null) image = keep(image.flip(plan.flip))

  return image
}

/**
 * The shrink-on-load path.
 *
 * `size: 'force'` is what an unlocked aspect ratio compiles to — it is libvips'
 * own name for "produce exactly these dimensions" — while `down` and `both` fit
 * the image inside the box and differ only in whether they may enlarge it.
 * `planGeometry` has already decided which of the three this job means; nothing
 * here re-reads the user's settings.
 */
function thumbnail(module: VipsModule, bytes: Uint8Array, resize: ResizePlan | null): VipsImage {
  if (resize === null) {
    // Sequential access lets libvips stream the image in scanline regions rather
    // than materialise it, which is what the router's 4× expansion factor
    // assumes (`MEMORY.vips` in `lib/router/budget.ts`).
    return module.Image.newFromBuffer(bytes, '', { access: 'sequential' })
  }

  return module.Image.thumbnailBuffer(bytes, resize.width ?? UNBOUNDED_DIMENSION, {
    height: resize.height ?? UNBOUNDED_DIMENSION,
    size: thumbnailSize(resize),
  })
}

function thumbnailSize(resize: ResizePlan): string {
  if (resize.stretch) return 'force'

  return resize.enlarge ? 'both' : 'down'
}
