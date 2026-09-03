/**
 * The memory budget model: how much RAM a conversion may use on this device,
 * and therefore how large an input each engine can accept.
 *
 * Everything here is a pure function of `Capabilities`. Nothing in this module
 * touches `navigator`, `window` or `performance` — the values arrive as a
 * parameter so the router stays testable without a browser and safe under SSR.
 *
 * The numbers are empirical ceilings, not theory. Raising one because a file
 * "should" fit trades an honest rejection message for an out-of-memory crash
 * that takes the user's tab — and their file — with it. Change them only after
 * measuring on real devices.
 */

import { MAX_CANVAS_PIXELS } from '@/lib/engines/canvas-limits'

import type { Capabilities, EngineId, EngineMemory, JobInput } from './types'

const MB = 1024 * 1024
const BYTES_PER_GB = 1024 * MB

/**
 * iOS budget.
 *
 * Mobile Safari enforces a per-tab memory limit far below the device's physical
 * RAM and terminates the tab without warning — no `onerror`, no catchable
 * exception, just a blank page. 90 MB is the level at which a WASM heap plus
 * the surrounding page reliably survives on the weakest supported iPhone.
 * Reported `deviceMemory` is irrelevant here: the ceiling is the browser's, not
 * the hardware's, so an 8 GB iPad Pro gets the same allowance as an iPhone SE.
 */
export const IOS_BUDGET_BYTES = 90 * MB

/**
 * Android budget.
 *
 * Chrome on Android kills background and foreground tabs more gracefully than
 * iOS and allows a larger WASM heap, but low-end devices still swap heavily
 * past this point. 140 MB keeps conversions responsive on 2–3 GB phones, which
 * dominate the Android install base.
 */
export const ANDROID_BUDGET_BYTES = 140 * MB

/**
 * Share of a desktop machine's RAM the app is willing to claim.
 *
 * A browser tab is a guest: the user has an OS, other tabs and other apps
 * running. One fifth of physical memory is aggressive enough to convert large
 * files and modest enough that the machine does not start swapping.
 */
export const DESKTOP_MEMORY_SHARE = 0.2

/**
 * Hard desktop ceiling.
 *
 * wasm32 addresses at most 4 GB, and the engines we ship become unstable well
 * before that as allocation failures inside the module surface as unrecoverable
 * aborts. 1200 MB sits comfortably under that ledge, so a 64 GB workstation
 * gains no more headroom than an 8 GB laptop — the limit is the WASM heap, not
 * the machine.
 */
export const DESKTOP_BUDGET_CAP_BYTES = 1200 * MB

/**
 * Desktop floor.
 *
 * `navigator.deviceMemory` is coarse, clamped to 0.25 at the low end, and
 * absent outside Chromium — so a desktop can report a value that would derive a
 * budget smaller than a phone's. The floor matches the Android ceiling: a real
 * desktop browser is never subject to the aggressive tab-kill policies that set
 * the mobile numbers, so it should never be allowed less than a phone.
 */
export const DESKTOP_BUDGET_FLOOR_BYTES = ANDROID_BUDGET_BYTES

/**
 * How much memory each engine holds, as `factor × heldBytes + reserveBytes`.
 *
 * `Record<EngineId, EngineMemory>` is deliberate: adding an `EngineId` without a
 * model here is a compile error, and a model for an engine that does not exist
 * is one too. That is also why the table lives here rather than on
 * `EngineDescriptor` — two of the ten ids have no descriptor yet, and a
 * descriptor field would turn "nobody wrote a model for the ZIP engine" from a
 * failed build into a silent default on the day it ships.
 *
 * Determine a new engine's numbers by measurement — a guess that is too low is
 * an out-of-memory crash on someone's phone.
 * `docs/router/memory-budget-measurement.md` is the harness, the corpus and the
 * recorded runs. It also says, row by row, which of the entries below are
 * measured and which are carried over from before it existed: `pdflib` and `zip`
 * are measured, `pdfjs` is half measured, and the other seven are not.
 */
export const MEMORY: Record<EngineId, EngineMemory> = {
  /**
   * Measured in Chromium, by `docs/router/browser-memory-measure.mjs`.
   *
   * The entry the byte model was worst at, and the reason `bytesPerPixel`
   * exists. The sweep runs the same decode at 1, 2, 6, 12 and 24 megapixels and
   * reports **4.00–4.04 bytes per decoded pixel**, flat across the range. It
   * then runs two 6 megapixel images whose encoded sizes are 165× apart — a
   * flat screenshot at 0.1 MB and incompressible noise at 17.2 MB — and both
   * peak at 22.9 MB. Same pixels, same memory; the old factor of 6 was 205×
   * short on one of them and 4× over on the other.
   *
   * 6 bytes a pixel: 4.00 measured for the decoded bitmap and its canvas, plus
   * 2 for the encoded output, which `measureUserAgentSpecificMemory` does not
   * attribute to the renderer at all — its worst measured case is a 2.9 B/px
   * incompressible PNG re-encode and its typical case is 0.3.
   *
   * The byte factor of 6 stays, and stays unmeasurable, because it is what
   * answers when the caller could not read a header: there is no pixel count to
   * charge then, and a job with no bound at all is the failure this table
   * exists to prevent. The sweep says exactly how wrong it is in each
   * direction — 205× low on the flat image, 4.5× high on the noisy one — which
   * is the argument for the pixel term rather than for a different factor.
   * Where both are known the job is charged both, and over-charging a job whose
   * pixels are known is the safe direction.
   */
  canvas: { factor: 6, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 6 },
  /** Not measured. libvips works in scanline regions rather than whole images,
   *  so it holds much less than a canvas for the same pixel count — and charges
   *  nothing per pixel for the same reason: it never materialises the bitmap.
   *  `lib/engines/vips.ts` says the same thing about its missing guard. */
  vips: { factor: 4, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 0 },
  /**
   * The reserve is measured; the per-pixel term is arithmetic on top of a
   * measurement. `docs/router/browser-memory-measure.mjs`.
   *
   * Instantiating libheif and decoding *nothing* costs **20.5 MB** — a WASM
   * heap allocated before the first pixel is looked at, identical for a
   * 500-byte thumbnail and a 48 megapixel photograph. A factor on the input
   * bytes cannot express that at all: the old model priced the 499-byte fixture
   * at 2.5 kB against a reality of 20.6 MB. 21 MB is the reserve.
   *
   * The byte factor of 5 is unchanged and still unmeasured: like canvas's, it
   * is the fallback for a job whose pixels nobody read, and the corpus that
   * could replace it does not exist.
   *
   * The pixel term could not be fitted the same way — the repository holds one
   * HEIC, 64 × 64, and 4096 pixels cannot separate a slope from noise; there is
   * no HEIC encoder in this build to make a corpus with (see
   * `lib/engines/heif-decode.ts`). 8 is arithmetic instead: `heif-decode.ts`
   * allocates `width × height × 4` for the RGBA buffer libheif fills, and
   * `heif.ts` then draws that onto a canvas, which the canvas sweep measured at
   * 4.00. Both are live at once. `memory-budget-measurement.md` records this as
   * the one row still waiting on a corpus.
   */
  heif: { factor: 5, holds: 'one-at-a-time', reserveBytes: 21 * MB, bytesPerPixel: 8 },
  /**
   * Measured across four operations. Counting the `Blob` copy the browser makes
   * of the serialised result, merge peaks at 2.91× its inputs, images → PDF at
   * 2.74–3.01×, organise at 3.03× and split at 4.02×. 4 is the worst of them,
   * and one entry has to serve all four.
   *
   * `all-at-once` because every source ends up in one object graph: the pages
   * copied out of each document stay live until the merge is written, so a
   * hundred 50 MB scans cost their total and not their largest. Merging 30 scans
   * and merging those same 30 plus 30 tiny documents peak within 3 MB of each
   * other, which is what says the cost follows the total rather than the count.
   *
   * The 32 MB reserve is what pdf-lib costs before the input is considered: a
   * hundred small documents peaked at 25.7 MB on 1.2 MB of input. Splitting a
   * 200-page report peaked at 43.7 MB on 0.3 MB and is *not* covered — that cost
   * follows page count, which the router cannot see, and the document explains
   * why 32 MB is still the right number.
   */
  /*
   * `bytesPerPixel: 0` although it decodes: pdf-lib's per-pixel cost depends on
   * the *format* and this table does not see one. `embedPng` holds raw samples
   * until `save()` — 8 bytes a pixel, measured — while `embedJpg` scans to SOF0
   * and copies the bytes without running a decoder, so a 288 megapixel JPEG
   * costs its bytes and nothing more. Charging either rate here would refuse a
   * camera panorama or admit a screenshot batch. That bound therefore stays in
   * `lib/engines/raster-limits.ts`, where the format is in hand, and it is
   * measured and tested there.
   */
  pdflib: { factor: 4, holds: 'all-at-once', reserveBytes: 32 * MB, bytesPerPixel: 0 },
  /**
   * The resolution-bound engine, and the one number here that is still part
   * estimate. Parsing a document measured at 1.03× its bytes; the render, the
   * encoded page held until the archive is packed, and the `Blob` copy of that
   * archive cannot be measured outside a browser, and 4 is the estimate for all
   * of it together. Re-measure before trusting it.
   *
   * The reserve is the part no factor can express. A page canvas is sized by
   * the requested DPI and not by the file: at the default 150 dpi a US Letter
   * page is 1275 × 1650 × 4 = 8.0 MB of RGBA, whether it came from a 13 kB
   * vector document or a 78 MB scan. 32 MB covers that canvas, the encoded copy
   * taken off it, and the 17.8–34.4 MB pdf.js itself costs to open a document at
   * all.
   */
  pdfjs: { factor: 4, holds: 'one-at-a-time', reserveBytes: 32 * MB, bytesPerPixel: 0 },
  /**
   * Not measured directly; derived from what the pipeline actually holds.
   *
   * A stream copy never decodes, so there is no frame, no bitmap and nothing
   * whose size the file's own bytes fail to predict — which is why the reserve
   * and the per-pixel term are both zero, and why this is the one media engine
   * whose model is arithmetic rather than an estimate. Three copies of the
   * payload are live at the peak: the samples lifted out of the source, the
   * container mp4box serialises them back into, and the copy taken off that
   * stream on the way to a `Blob`. The source buffer itself is released before
   * the write begins.
   *
   * Three is therefore a ceiling on the observed shape rather than a guess at an
   * unobserved one, and it is 1.5x kinder than `ffmpeg` — the engine that would
   * otherwise take these pairs on a device with no codecs. It is kinder than
   * `webcodecs` too, which is the right way round and was not always so (#210):
   * a copy never builds a second payload out of the first, so it holds strictly
   * less than a transcode of the same file and may be handed a larger one. A
   * job too large to copy is therefore too large to transcode as well, and the
   * ceiling a rejection quotes is this one — the roomiest any engine here has.
   */
  remux: { factor: 3, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 0 },
  /**
   * Not measured directly; derived from what the pipeline holds, the same way
   * `remux` above is.
   *
   * It replaces a 2.5 that was derived from nothing. That number was written
   * before the engine existed and described a transcode that streamed frames
   * out of a file it never held; `lib/engines/video-transcode.ts` shipped in
   * #47 holding a good deal more, and #210 is the correction.
   *
   * Four things are live at the muxing peak, each about one copy of the input's
   * encoded bytes:
   *
   * 1. the file itself, which the worker still owns on behalf of its caller;
   * 2. the encoded samples the encoder produced, which for a transcode that
   *    does not enlarge the file is at most one more;
   * 3. the container mp4box serialises them back into;
   * 4. the copy taken off that stream on the way to a `Blob`.
   *
   * The demuxed source is deliberately not a fifth. It is released sample by
   * sample as the decoder consumes it — `lib/engines/mp4-samples.ts` — so it is
   * gone before the muxer runs rather than sitting alongside its output. The
   * decoded frames are not a term either: the queue limits in the transcode
   * loop hold a handful of surfaces rather than a film's worth of them.
   *
   * Four is what that adds up to, and the ordering it produces is the honest
   * one — `remux` at 3 below a transcode, `ffmpeg` at 4.5 above it, and a
   * ceiling on this desktop of 300 MB rather than the 480 MB the old entry
   * promised a device that could not have delivered it.
   */
  webcodecs: { factor: 4, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 0 },
  /** Not measured — no engine ships yet. Input, output and scratch buffers all
   *  live in MEMFS simultaneously, which is why it is also the last resort. */
  ffmpeg: { factor: 4.5, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 0 },
  /** Measured through `fflate` itself, which is what the engine will be built
   *  on: `zipSync` is handed every member and builds the archive in one buffer,
   *  so a job costs what its members add up to — 2.93× on 447 MB of input and
   *  3.42× on a job small enough for fflate's own working set to show. */
  zip: { factor: 3, holds: 'all-at-once', reserveBytes: 0, bytesPerPixel: 0 },
  /** Not measured — no engine ships yet. libarchive buffers a whole entry plus
   *  the compressed source. */
  libarchive: { factor: 3, holds: 'one-at-a-time', reserveBytes: 0, bytesPerPixel: 0 },
}

/**
 * Total memory a conversion may use on this device, in bytes.
 *
 * Mobile platforms return a fixed browser-imposed ceiling. Desktop derives from
 * `deviceMemoryGb`, then clamps into `[DESKTOP_BUDGET_FLOOR_BYTES,
 * DESKTOP_BUDGET_CAP_BYTES]` so neither a missing nor an implausible reading
 * can produce a dangerous number. Always a whole number of bytes.
 */
export function budgetBytes(caps: Capabilities): number {
  switch (caps.platform) {
    case 'ios':
      return IOS_BUDGET_BYTES
    case 'android':
      return ANDROID_BUDGET_BYTES
    case 'desktop':
      return desktopBudgetBytes(caps.deviceMemoryGb)
    default:
      return budgetForUnhandledPlatform(caps.platform)
  }
}

/** Desktop branch of {@link budgetBytes}, split out to keep the dispatch flat. */
function desktopBudgetBytes(reportedGb: number): number {
  // `deviceMemory` is absent outside Chromium and can be probed as 0 or NaN;
  // treat anything implausible as "unknown" rather than as "tiny machine".
  if (!Number.isFinite(reportedGb) || reportedGb <= 0) return DESKTOP_BUDGET_FLOOR_BYTES

  const derived = Math.floor(reportedGb * BYTES_PER_GB * DESKTOP_MEMORY_SHARE)
  return Math.min(Math.max(derived, DESKTOP_BUDGET_FLOOR_BYTES), DESKTOP_BUDGET_CAP_BYTES)
}

/**
 * Exhaustiveness guard for {@link budgetBytes}.
 *
 * The `never` parameter makes adding a `Platform` without giving it a ceiling a
 * compile error here, rather than a silent fallthrough — and a fallthrough to
 * the desktop branch would hand an unknown device the *largest* allowance,
 * which is the worst possible default for a module whose failure mode is a
 * killed tab. At runtime the value can only be a stale `Capabilities` object
 * rehydrated from sessionStorage, so answer with the most conservative ceiling
 * instead of throwing in the middle of the user's conversion.
 */
function budgetForUnhandledPlatform(platform: never): number {
  void platform
  return IOS_BUDGET_BYTES
}

/**
 * The bytes of `job` that `memory` says are live at the same time.
 *
 * The whole job for an engine that opens every file together, the largest file
 * for one that works through them in turn. A single-file job answers the same
 * either way, which is why the distinction went unnoticed until merge shipped.
 */
export function heldBytes(memory: EngineMemory, job: JobInput): number {
  return memory.holds === 'all-at-once' ? job.totalBytes : job.largestBytes
}

/**
 * The decoded pixels of `job` that `memory` says are live at the same time.
 *
 * Scoped the same way as {@link heldBytes} and for the same reason. Zero
 * whenever the caller passed no pixel counts, which is what keeps a job routed
 * from bytes alone behaving exactly as it did before the term existed.
 */
export function heldPixels(memory: EngineMemory, job: JobInput): number {
  return memory.holds === 'all-at-once' ? job.totalPixels : job.largestPixels
}

/**
 * Peak memory `job` will cost under `memory`, in bytes.
 *
 * Three terms, because three different things pay for a conversion: what the
 * encoded bytes cost, what the *decoded* pixels cost, and what the engine costs
 * before it is given anything. The middle one is not a refinement of the first
 * — it is the term that makes the model true for an image at all, since a
 * decoded bitmap is `width × height × bytes` however well the file compressed.
 * `docs/router/memory-budget-measurement.md` is the measurement.
 */
export function peakBytes(memory: EngineMemory, job: JobInput): number {
  return (
    memory.factor * heldBytes(memory, job) +
    memory.bytesPerPixel * heldPixels(memory, job) +
    memory.reserveBytes
  )
}

/**
 * Whether an image in `job` is larger than a browser canvas can hold.
 *
 * Not a memory budget — a flat fact about the platform, and the one bound that
 * does not move with the device. Past {@link MAX_CANVAS_PIXELS} a canvas comes
 * back *blank* rather than throwing, so the engines that decode through one
 * refuse first (`assertBitmapFits` in `lib/engines/raster-limits.ts`). Until
 * this check existed the router admitted those jobs happily and the user paid
 * for a download and a worker before being told no, which is a worse error than
 * being told up front.
 *
 * "Charges per decoded pixel" and "decodes through a browser bitmap" are the
 * same set of engines by construction: an engine that never materialises a
 * bitmap has nothing to charge for. `vips` is the case that proves it — it
 * streams scanline regions, is exempt from the guard in the engines, and
 * carries `bytesPerPixel: 0` here.
 *
 * Answers on the largest single image whatever the engine's scope: two images
 * are never on one canvas, so a total says nothing about this.
 */
export function fitsBitmapCeiling(engine: EngineId, job: JobInput): boolean {
  if (MEMORY[engine].bytesPerPixel === 0) return true

  return job.largestPixels <= MAX_CANVAS_PIXELS
}

/**
 * The most an engine with this model may hold inside `budget`.
 *
 * The reserve comes off the top before the factor is applied: an engine that
 * allocates 32 MB whatever it is given has 32 MB less to spend on the file.
 * Never negative — a reserve larger than the whole budget means the engine
 * cannot run here at all, which is `0` rather than a negative ceiling nobody
 * can compare against.
 */
export function maxHeldBytes(memory: EngineMemory, budget: number): number {
  return Math.max(0, Math.floor((budget - memory.reserveBytes) / memory.factor))
}

/**
 * Largest input, in bytes, that `engine` can process on this device.
 *
 * This is the number a `FILE_TOO_LARGE` / `DEVICE_TOO_WEAK` rejection quotes
 * back to the user. What it is a ceiling *on* depends on the engine's
 * {@link EngineMemory.holds}: the total across every file for `all-at-once`,
 * the largest single file for `one-at-a-time`.
 */
export function maxInputBytes(engine: EngineId, caps: Capabilities): number {
  return maxHeldBytes(MEMORY[engine], budgetBytes(caps))
}

/**
 * Whether `job` can be processed by `engine` on this device.
 *
 * Inclusive: a job exactly on the limit fits. An empty input also "fits" —
 * rejecting that is the router's `EMPTY_INPUT` check, not the budget's job.
 */
export function fitsInBudget(engine: EngineId, job: JobInput, caps: Capabilities): boolean {
  return fitsBitmapCeiling(engine, job) && peakBytes(MEMORY[engine], job) <= budgetBytes(caps)
}
