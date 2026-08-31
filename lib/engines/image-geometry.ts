/**
 * Turning "crop this, then make it 800 wide, then turn it upright" into a plan
 * an engine can execute — and into the output dimensions it will produce.
 *
 * Four operations share one module because they share one question: what shape
 * does the file come out? Answering that in the engine, mixed into libvips
 * calls, is how a resize silently ignores an aspect-ratio lock or a crop rect
 * dragged past the edge of the picture becomes a WASM abort. Answering it here
 * makes the arithmetic — clamping, fitting, the axis swap a quarter turn causes —
 * a pure function of two records, provable without a codec.
 *
 * ## The order, and why it is that order
 *
 * `crop → resize → rotate → flip`, always.
 *
 * - **Crop first** because everything after it is cheaper on fewer pixels, and
 *   because the rect is in *source* coordinates. Resizing first would leave the
 *   user's selection pointing at the wrong pixels.
 * - **Resize before rotate** because `width` means the width of the image the
 *   user was looking at when they typed it. A quarter turn swaps the axes, so
 *   rotating first would silently reinterpret 800 × 600 as 600 × 800.
 * - **Flip last** because it changes nothing about size and everything about
 *   orientation, so it is the one step that can be reasoned about on its own.
 *
 * ## What "aspect-ratio locking" means here
 *
 * Only a resize can break an aspect ratio, so the lock is a resize setting. On —
 * the default — the image is fitted *inside* the requested box and keeps its
 * proportions; off, and with both axes given, it is stretched to exactly the
 * requested size. With only one axis given there is nothing to unlock: the other
 * axis follows from the ratio either way. Crop changes the ratio by definition,
 * a quarter turn swaps it, and a flip preserves it — none of them consult the
 * lock, which is why it lives on {@link ResizePlan} rather than on the job.
 */

import type { CropRect, FlipAxis, ImageOptions, RotationAngle } from './image-options'
import type { ImageSize } from './raster-size'

/** A resize reduced to what an engine has to do about it. */
export interface ResizePlan {
  /** Requested width in pixels, or `undefined` for "whatever the ratio gives". */
  width?: number
  /** Requested height in pixels, on the same terms. */
  height?: number
  /**
   * Ignore the source's proportions and produce exactly `width × height`.
   *
   * Only ever true when the job turned the aspect lock off *and* gave both
   * axes — a single axis has no second dimension to disagree with.
   */
  stretch: boolean
  /** Whether the image may be scaled up past its own resolution. */
  enlarge: boolean
}

/** Every geometry change one job asks for, normalised and in execution order. */
export interface GeometryPlan {
  /** Clamped into the source, or `null` when nothing is being cut away. */
  crop: CropRect | null
  resize: ResizePlan | null
  /** Clockwise degrees. `0` means no rotation. */
  rotate: RotationAngle
  flip: FlipAxis | null
}

/** Whether `plan` asks for anything at all. */
export function isIdentity(plan: GeometryPlan): boolean {
  return plan.crop === null && plan.resize === null && plan.rotate === 0 && plan.flip === null
}

/**
 * Whether executing `plan` needs the whole image in memory at once.
 *
 * A rotation and a vertical flip both read the source bottom-up, which a
 * scanline-at-a-time pipeline cannot serve: libvips' sequential access mode
 * promises each row is read once, in order, and either operation breaks that
 * promise on the first row it asks for. Cropping and resizing do not — both
 * read forwards — so the streaming pipeline, and the memory model in
 * `MEMORY.vips` that assumes it, survive every job that does not rotate or flip.
 *
 * A horizontal flip is reversible within one row and could in principle stream;
 * it is grouped with the others because libvips implements both directions
 * through the same operation, and guessing which half of it streams is not worth
 * a crash on someone's phone.
 */
export function needsWholeImage(plan: GeometryPlan): boolean {
  return plan.rotate !== 0 || plan.flip !== null
}

/**
 * Reads `options` against a known source size and normalises every request into
 * something an engine can execute without further judgement.
 *
 * `source` is required rather than optional because half the normalisation needs
 * it: a crop rect is only meaningful relative to the picture it cuts, and a rect
 * that selects everything is not a crop at all.
 *
 * Throws only for a crop that selects nothing — see {@link clampCrop}. Every
 * other unusable input is normalised away rather than raised, because a slider
 * at zero is a UI state and not a reason to fail a conversion.
 */
export function planGeometry(options: ImageOptions | undefined, source: ImageSize): GeometryPlan {
  const crop = clampCrop(options?.crop, source)
  const base = crop ?? source

  return {
    crop,
    resize: planResize(options, base),
    rotate: options?.rotate ?? 0,
    flip: options?.flip ?? null,
  }
}

/**
 * The dimensions `plan` will produce from `source`.
 *
 * The predictable half of "predictable output": a caller can show the user the
 * result before a single pixel is decoded, and a test can pin what an
 * aspect-ratio lock actually does without running libvips.
 */
export function outputSize(plan: GeometryPlan, source: ImageSize): ImageSize {
  const cropped = plan.crop ?? source
  const resized = plan.resize === null ? cropped : resizedSize(plan.resize, cropped)

  // A quarter turn in either direction swaps the axes; a half turn does not.
  return plan.rotate === 90 || plan.rotate === 270
    ? { width: resized.height, height: resized.width }
    : resized
}

/**
 * The exact size a {@link ResizePlan} produces from `base`.
 *
 * Separate from {@link outputSize} because an engine that has to scale by hand —
 * anything downstream of a crop, where shrink-on-load is no longer available —
 * needs the target dimensions to derive its scale factors from, and deriving
 * them twice in two places is how the two paths drift apart by a pixel.
 *
 * Never returns a zero dimension: rounding a 1 × 4000 image into a 100-wide box
 * would otherwise ask the encoder for a width of zero.
 */
export function resizedSize(plan: ResizePlan, base: ImageSize): ImageSize {
  if (plan.stretch && plan.width !== undefined && plan.height !== undefined) {
    return { width: atLeastOnePixel(plan.width), height: atLeastOnePixel(plan.height) }
  }

  const scale = fitScale(plan, base)

  return {
    width: atLeastOnePixel(Math.round(base.width * scale)),
    height: atLeastOnePixel(Math.round(base.height * scale)),
  }
}

/**
 * The single factor that fits `base` inside the requested box.
 *
 * The smaller of the two axis ratios, because fitting means *both* constraints
 * hold; an axis the job left out imposes none. Capped at 1 unless the job asked
 * to enlarge, since upscaling invents detail that was never in the file.
 */
function fitScale(plan: ResizePlan, base: ImageSize): number {
  const ratios: number[] = []
  if (plan.width !== undefined && base.width > 0) ratios.push(plan.width / base.width)
  if (plan.height !== undefined && base.height > 0) ratios.push(plan.height / base.height)

  if (ratios.length === 0) return 1

  const scale = Math.min(...ratios)

  return plan.enlarge ? scale : Math.min(scale, 1)
}

/**
 * Normalises the job's resize request, or `null` when it asks for no resize.
 *
 * A dimension that is not a positive finite number is dropped rather than
 * refused — a cleared input box reads as `NaN` and means "no constraint on this
 * axis", not "fail the conversion".
 */
function planResize(options: ImageOptions | undefined, base: ImageSize): ResizePlan | null {
  const width = positiveDimension(options?.width)
  const height = positiveDimension(options?.height)
  if (width === undefined && height === undefined) return null

  const locked = options?.lockAspectRatio !== false
  const stretch = !locked && width !== undefined && height !== undefined
  const plan: ResizePlan = { width, height, stretch, enlarge: options?.enlarge === true }

  // A resize that would leave the image exactly as it is is not a resize; saying
  // so here keeps the engine on its fastest path for a job that only rotates.
  const target = resizedSize(plan, base)
  if (target.width === base.width && target.height === base.height) return null

  return plan
}

/**
 * The requested rectangle, intersected with the picture it is cutting.
 *
 * Intersection rather than rejection, because a selection dragged past the edge
 * of the image is the normal way people use a crop handle, and the rectangle
 * they can see is the one they mean. What cannot be salvaged is a rectangle that
 * overlaps nothing at all: there is no image left to write, so it fails here
 * with a sentence that says which numbers were impossible rather than inside a
 * codec with one that does not.
 *
 * A rect covering the whole source answers `null` — that is not a crop, and
 * treating it as one would cost the engine its streaming pipeline for nothing.
 */
export function clampCrop(rect: CropRect | undefined, source: ImageSize): CropRect | null {
  if (rect === undefined) return null

  const left = clamp(Math.floor(rect.left), 0, source.width)
  const top = clamp(Math.floor(rect.top), 0, source.height)
  const right = clamp(Math.floor(rect.left + rect.width), left, source.width)
  const bottom = clamp(Math.floor(rect.top + rect.height), top, source.height)

  const width = right - left
  const height = bottom - top

  if (width <= 0 || height <= 0) {
    throw new Error(
      `The crop area (${describe(rect)}) does not overlap the image, which is ` +
        `${source.width} × ${source.height} pixels. Choose an area inside it.`,
    )
  }

  if (left === 0 && top === 0 && width === source.width && height === source.height) return null

  return { left, top, width, height }
}

function describe(rect: CropRect): string {
  return `${rect.width} × ${rect.height} at ${rect.left}, ${rect.top}`
}

function clamp(value: number, low: number, high: number): number {
  if (!Number.isFinite(value)) return low

  return Math.min(Math.max(value, low), high)
}

function atLeastOnePixel(value: number): number {
  return Math.max(1, Math.floor(value))
}

/**
 * A requested pixel dimension, or `undefined` when the job named none.
 *
 * Anything that is not a positive finite number is "none" rather than an error:
 * a cleared input box reads as `NaN` and means "no constraint on this axis", not
 * "fail the conversion". Exported because the SVG path in `./canvas-svg` reads
 * the same two fields under different rules about enlarging, and two copies of
 * this is how the two paths come to disagree about what `0` means.
 */
export function positiveDimension(value: number | undefined): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined

  return Math.round(value)
}
