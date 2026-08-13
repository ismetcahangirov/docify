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

import type { Capabilities, EngineId } from './types'

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
 * Peak memory an engine holds, as a multiple of the encoded input size.
 *
 * `Record<EngineId, number>` is deliberate: adding an `EngineId` without a
 * factor here is a compile error, and a factor for an engine that does not
 * exist is one too. Determine a new engine's value by measurement — a guess
 * that is too low is an out-of-memory crash on someone's phone.
 */
export const EXPANSION: Record<EngineId, number> = {
  /** A decoded RGBA bitmap is many times its encoded source, and the canvas
   *  keeps the source, the bitmap and the re-encoded output alive at once. */
  canvas: 6,
  /** libvips works in scanline regions rather than whole images, so it holds
   *  much less than a canvas for the same pixel count. */
  vips: 4,
  /** HEIC decoding materialises the full tiled image plus the RGB output. */
  heif: 5,
  /** pdf-lib mutates a parsed document tree and serialises a fresh copy. */
  pdflib: 3,
  /** pdf.js additionally rasterises pages to canvases while rendering. */
  pdfjs: 4,
  /** Streams frames through the hardware codec; never holds the whole file. */
  webcodecs: 2.5,
  /** Input, output and scratch buffers all live in MEMFS simultaneously —
   *  the hungriest engine we ship, which is why it is also the last resort. */
  ffmpeg: 4.5,
  /** fflate streams entries, but the deflate window and one member are live. */
  zip: 2.5,
  /** libarchive buffers a whole entry plus the compressed source. */
  libarchive: 3,
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
 * Largest input, in bytes, that `engine` can process on this device.
 *
 * This is the number the router filters candidate engines with, and the number
 * a `FILE_TOO_LARGE` / `DEVICE_TOO_WEAK` rejection quotes back to the user.
 */
export function maxInputBytes(engine: EngineId, caps: Capabilities): number {
  return Math.floor(budgetBytes(caps) / EXPANSION[engine])
}

/**
 * Whether an input of `inputBytes` can be processed by `engine` on this device.
 *
 * Inclusive: a file exactly on the limit fits. An empty input also "fits" —
 * rejecting that is the router's `EMPTY_INPUT` check, not the budget's job.
 */
export function fitsInBudget(engine: EngineId, inputBytes: number, caps: Capabilities): boolean {
  return inputBytes <= maxInputBytes(engine, caps)
}
