/**
 * The input side of a conversion, normalised.
 *
 * `route()` accepts either one size or one size per file, and every consumer
 * downstream — the budget, the rejection copy — wants the same four numbers out
 * of it. Doing that reduction once, here, is what keeps `budget.ts` free of
 * argument shapes and `route.ts` free of arithmetic.
 *
 * Pure and synchronous, like everything else under `lib/router/`: no `File`, no
 * `Blob`, no reading. A size is a number, and where it came from is the caller's
 * business.
 */

import type { JobInput, RouteFile, RouteInput } from './types'

/**
 * Reduces `input` to the numbers the budget reasons about.
 *
 * Nonsense survives the reduction rather than being repaired: `NaN` in, `NaN`
 * out. Substituting a zero here would turn an unreadable size into a job that
 * looks free, and the budget would wave it through; {@link isMeasurable} is the
 * gate, and it is the router's first check.
 *
 * Never mutates `input` — the array a caller passes is the user's file order,
 * and sorting it in place would reorder their merge.
 */
export function jobInput(input: RouteInput): JobInput {
  if (typeof input === 'number') {
    return sized(input, input, input, 1)
  }

  if (input.length === 0) {
    return sized(0, 0, 0, 0)
  }

  // A list of files says two things per entry; a list of numbers says one. The
  // pixel half is optional per file, and a file that omits it contributes
  // nothing to either pixel total rather than a zero that would look measured.
  if (typeof input[0] === 'object') return fileJobInput(input as readonly RouteFile[])

  // Seeded from the first entry rather than from ±Infinity, so that a list of
  // one unreadable size reports that size back instead of an invented bound.
  // Not `Math.max`/`Math.min` over a spread either: a merge can name a hundred
  // files, and a spread that long is an argument list rather than a loop.
  const sizes = input as readonly number[]
  let totalBytes = 0
  let largestBytes = sizes[0]
  let smallestBytes = sizes[0]

  for (const size of sizes) {
    totalBytes += size
    if (size > largestBytes) largestBytes = size
    if (size < smallestBytes) smallestBytes = size
  }

  return sized(totalBytes, largestBytes, smallestBytes, sizes.length)
}

/** The four byte numbers, with no pixel information attached. */
function sized(
  totalBytes: number,
  largestBytes: number,
  smallestBytes: number,
  fileCount: number,
): JobInput {
  return { totalBytes, largestBytes, smallestBytes, fileCount, totalPixels: 0, largestPixels: 0 }
}

/**
 * The same reduction over files that also carry a pixel count.
 *
 * `largestPixels` is the largest *pixel count*, not the pixel count of the
 * largest file. They are not the same image and the difference is the whole
 * point: a flat 24 megapixel screenshot is smaller in bytes than a photograph
 * a quarter its size, and it is the screenshot that decides whether the decode
 * fits.
 */
function fileJobInput(files: readonly RouteFile[]): JobInput {
  let totalBytes = 0
  let largestBytes = files[0].bytes
  let smallestBytes = files[0].bytes
  let totalPixels = 0
  let largestPixels = 0

  for (const file of files) {
    totalBytes += file.bytes
    if (file.bytes > largestBytes) largestBytes = file.bytes
    if (file.bytes < smallestBytes) smallestBytes = file.bytes

    const pixels = file.pixels ?? 0
    totalPixels += pixels
    if (pixels > largestPixels) largestPixels = pixels
  }

  return {
    totalBytes,
    largestBytes,
    smallestBytes,
    fileCount: files.length,
    totalPixels,
    largestPixels,
  }
}

/**
 * Whether every file in the job has a size that can be budgeted.
 *
 * Requires at least one file, and requires each of them to have bytes in it. A
 * zero-byte member of a hundred-file merge is refused with the rest, because
 * the parser is going to throw on it anyway — after the download, several
 * minutes in, having done ninety-nine files of real work first.
 *
 * The extremes are enough to decide this for the whole list: if the smallest
 * file is positive and finite and the total is finite, no member can be empty,
 * negative or infinite.
 */
export function isMeasurable(job: JobInput): boolean {
  if (job.fileCount <= 0) return false
  if (!Number.isFinite(job.totalBytes) || job.totalBytes <= 0) return false

  return Number.isFinite(job.smallestBytes) && job.smallestBytes > 0
}
