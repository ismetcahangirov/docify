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
 * `EngineDescriptor` — four of the nine ids have no descriptor yet, and a
 * descriptor field would turn "nobody wrote a model for the ZIP engine" from a
 * failed build into a silent default on the day it ships.
 *
 * Determine a new engine's numbers by measurement — a guess that is too low is
 * an out-of-memory crash on someone's phone.
 * `docs/router/memory-budget-measurement.md` is the harness the pdf-lib and
 * pdf.js rows below came out of, and the instructions for repeating it.
 */
export const MEMORY: Record<EngineId, EngineMemory> = {
  /** A decoded RGBA bitmap is many times its encoded source, and the canvas
   *  keeps the source, the bitmap and the re-encoded output alive at once.
   *  One image is decoded at a time, so a batch costs what its biggest member
   *  costs rather than what the batch adds up to. */
  canvas: { factor: 6, holds: 'one-at-a-time', reserveBytes: 0 },
  /** libvips works in scanline regions rather than whole images, so it holds
   *  much less than a canvas for the same pixel count. */
  vips: { factor: 4, holds: 'one-at-a-time', reserveBytes: 0 },
  /** HEIC decoding materialises the full tiled image plus the RGB output. */
  heif: { factor: 5, holds: 'one-at-a-time', reserveBytes: 0 },
  /**
   * Measured at 4× on the corpus in `docs/router/memory-budget-measurement.md`:
   * a merge peaks near 2.9× its inputs and a split near 4.0×, both counting the
   * `Blob` copy the browser makes of the serialised result.
   *
   * `all-at-once` because every source ends up in one object graph: the pages
   * copied out of each document stay live until the merge is written, so a
   * hundred 50 MB scans cost their total and not their largest. The 32 MB
   * reserve is what pdf-lib costs before the input is even considered — a
   * hundred small documents peaked at 28 MB on 1.3 MB of input, and splitting a
   * 200-page report at 51 MB on 0.3 MB.
   */
  pdflib: { factor: 4, holds: 'all-at-once', reserveBytes: 32 * MB },
  /**
   * The resolution-bound engine. Parsing and rendering a document measured at
   * 2× its bytes, and the pages it writes out are held until the archive is
   * packed, which puts the whole job near 4×.
   *
   * The reserve is the part no factor can express. A page canvas is sized by
   * the requested DPI and not by the file: at the default 150 dpi a US Letter
   * page is 1275 × 1650 × 4 = 8.4 MB of RGBA, whether it came from a 1.4 kB
   * vector document or a 50 MB scan. 32 MB covers that canvas, the encoded copy
   * taken off it, and the 13–34 MB pdf.js itself costs to open a document at
   * all.
   */
  pdfjs: { factor: 4, holds: 'one-at-a-time', reserveBytes: 32 * MB },
  /** Streams frames through the hardware codec; never holds the whole file. */
  webcodecs: { factor: 2.5, holds: 'one-at-a-time', reserveBytes: 0 },
  /** Input, output and scratch buffers all live in MEMFS simultaneously —
   *  the hungriest engine we ship, which is why it is also the last resort. */
  ffmpeg: { factor: 4.5, holds: 'one-at-a-time', reserveBytes: 0 },
  /** fflate streams entries, but the archive is built in memory from all of
   *  them, so an archive job costs what its members add up to. */
  zip: { factor: 2.5, holds: 'all-at-once', reserveBytes: 0 },
  /** libarchive buffers a whole entry plus the compressed source. */
  libarchive: { factor: 3, holds: 'one-at-a-time', reserveBytes: 0 },
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

/** Peak memory `job` will cost under `memory`, in bytes. */
export function peakBytes(memory: EngineMemory, job: JobInput): number {
  return memory.factor * heldBytes(memory, job) + memory.reserveBytes
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
  return peakBytes(MEMORY[engine], job) <= budgetBytes(caps)
}
