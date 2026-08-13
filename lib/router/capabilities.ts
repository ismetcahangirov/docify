/**
 * What this device can actually do.
 *
 * Everything here is about *reading* the environment. Nothing here decides
 * anything: the router turns these facts into an engine choice, and it receives
 * them as a parameter.
 *
 * ## The isolation rule
 *
 * `probeCapabilities()` is never imported or called from inside the router
 * (CLAUDE.md §5.1). `route(task, inputBytes, caps)` takes `Capabilities` as an
 * argument, so the entire selection logic stays a pure function that unit tests
 * can exercise in milliseconds with no browser and no DOM. Calling the probe
 * inside the router would also break server rendering, because `navigator` does
 * not exist there. The call site is the UI, once, on the client.
 *
 * ## Two rules for the readings themselves
 *
 * 1. **Pure where it can be.** `parseUserAgent` and `detectWasmSimd` take their
 *    input as parameters, so both are testable without a browser.
 * 2. **Conservative, never optimistic.** A missing API reads as absent, and a
 *    missing number reads as the low estimate. Under-promising costs the user a
 *    slower engine; over-promising costs them a crashed tab.
 */

import type { Browser, Capabilities, Platform } from './types'

/**
 * A 31-byte WebAssembly module whose only function returns a `v128` built with
 * `i8x16.splat`. An engine without the SIMD proposal fails to validate it.
 *
 * This is the module from GoogleChromeLabs/wasm-feature-detect. Validating is
 * enough — the module is never instantiated, so the probe costs microseconds
 * and cannot throw on an engine that parses but refuses to compile SIMD.
 */
// Pinned to `ArrayBuffer` rather than the default `ArrayBufferLike`, so the
// bytes satisfy `BufferSource` and can be handed straight to `WebAssembly`.
export const WASM_SIMD_PROBE_MODULE: Uint8Array<ArrayBuffer> = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])

/**
 * Versioned so that adding a field to `Capabilities` cannot be satisfied by a
 * cache entry written before that field existed.
 */
export const CAPABILITIES_CACHE_KEY = 'docify.capabilities.v1'

/** How many simultaneous touches a real iPad reports. A Mac reports none. */
const IPADOS_TOUCH_POINTS = 2

/** Used when the browser will not say. Deliberately pessimistic. */
const FALLBACK_CORES = 2
const FALLBACK_MEMORY_GB_DESKTOP = 4
const FALLBACK_MEMORY_GB_MOBILE = 2

/**
 * `navigator.deviceMemory` is a non-standard Chromium extension, so it is typed
 * here rather than assumed to exist. This local shape is the reason the module
 * needs no `any` (CLAUDE.md §5.3).
 */
interface ProbeNavigator {
  readonly userAgent?: string
  readonly hardwareConcurrency?: number
  readonly maxTouchPoints?: number
  /** Chromium only, and quantised by the spec to 0.25 / 0.5 / 1 / 2 / 4 / 8. */
  readonly deviceMemory?: number
}

/** Globals that are absent on older browsers cannot be read off a typed `globalThis`. */
const globals = globalThis as unknown as Record<string, unknown>

/**
 * Classifies a user agent string.
 *
 * Order matters more than the individual patterns, because the strings overlap
 * by design: every Chromium UA ends in `Safari/`, and Edge's also contains
 * `Chrome/`. Narrowest match first.
 *
 * `maxTouchPoints` is a parameter rather than a `navigator` read so this stays a
 * pure function. It only matters for one case — see `detectPlatform`.
 */
export function parseUserAgent(
  ua: string,
  maxTouchPoints = 0,
): { platform: Platform; browser: Browser } {
  return { platform: detectPlatform(ua, maxTouchPoints), browser: detectBrowser(ua) }
}

/**
 * iPadOS 13 and later send a user agent byte-identical to desktop Safari's, so
 * the UA alone cannot tell an iPad from a Mac. Touch points break the tie: an
 * iPad reports 5, a Mac reports 0. The `Macintosh` guard keeps a Windows
 * touchscreen laptop from being misread as an iPad, and the threshold keeps a
 * Mac with a stray touch peripheral out too.
 *
 * Getting this wrong is expensive in one direction: an iPad classified as
 * desktop gets the desktop memory budget and Safari kills the tab.
 */
function detectPlatform(ua: string, maxTouchPoints: number): Platform {
  if (/iPad|iPhone|iPod/.test(ua)) return 'ios'
  if (/Macintosh/.test(ua) && maxTouchPoints > IPADOS_TOUCH_POINTS) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

/**
 * Reports the rendering engine, not the brand. Chrome on iOS (`CriOS`) is a
 * WebKit shell with Safari's codecs and Safari's memory ceiling, so it is
 * deliberately reported as `safari` — the router needs to know what will run
 * the job, not whose icon the user tapped.
 */
function detectBrowser(ua: string): Browser {
  if (/Firefox\/|FxiOS\//.test(ua)) return 'firefox'
  // Must precede the Safari check: Chromium and Edge UAs both end in `Safari/`.
  if (/Chrome\/|Chromium\/|Edg\//.test(ua)) return 'chromium'
  if (/Safari\//.test(ua)) return 'safari'
  return 'unknown'
}

/**
 * Reports whether the engine supports the WebAssembly SIMD proposal.
 *
 * The validator is injectable so the branches can be tested without a browser
 * and without a WebAssembly implementation. Left to itself it resolves the host
 * engine's `WebAssembly.validate` at call time.
 */
export function detectWasmSimd(validate?: (bytes: Uint8Array) => boolean): boolean {
  const wasm = globals.WebAssembly as { validate?: (bytes: Uint8Array) => boolean } | undefined
  const check = validate ?? wasm?.validate?.bind(wasm)
  if (typeof check !== 'function') return false

  try {
    return check(WASM_SIMD_PROBE_MODULE) === true
  } catch {
    // A hardened environment can disable WebAssembly outright. No SIMD, then.
    return false
  }
}

/**
 * Reads this device's capabilities, once per session.
 *
 * Client-only: call it from the UI and pass the result down. Never call it from
 * the router — see the module comment.
 */
export function probeCapabilities(): Capabilities {
  const cached = readCache()
  if (cached) return cached

  const caps = probeNow()
  writeCache(caps)
  return caps
}

function probeNow(): Capabilities {
  const nav = (globals.navigator ?? {}) as ProbeNavigator
  const { platform, browser } = parseUserAgent(nav.userAgent ?? '', nav.maxTouchPoints ?? 0)

  return {
    // Strict equality, so an environment that leaves this undefined reads false
    // and ffmpeg.wasm is told it has no SharedArrayBuffer.
    crossOriginIsolated: globals.crossOriginIsolated === true,
    wasmSimd: detectWasmSimd(),
    deviceMemoryGb: positiveOr(
      nav.deviceMemory,
      platform === 'desktop' ? FALLBACK_MEMORY_GB_DESKTOP : FALLBACK_MEMORY_GB_MOBILE,
    ),
    cores: positiveOr(nav.hardwareConcurrency, FALLBACK_CORES),
    // Half a codec is no codec: transcoding needs to decode and re-encode, so
    // both constructors must be present before the router may pick WebCodecs.
    webCodecsVideo: hasGlobalFunction('VideoEncoder') && hasGlobalFunction('VideoDecoder'),
    webCodecsAudio: hasGlobalFunction('AudioEncoder') && hasGlobalFunction('AudioDecoder'),
    offscreenCanvas: hasGlobalFunction('OffscreenCanvas'),
    createImageBitmap: hasGlobalFunction('createImageBitmap'),
    platform,
    browser,
  }
}

function hasGlobalFunction(name: string): boolean {
  return typeof globals[name] === 'function'
}

/** Guards against a browser reporting 0, NaN or a negative for a count. */
function positiveOr(value: number | undefined, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Hardware cannot change mid-session, so one probe per tab is enough — but the
 * storage itself is optional. Safari in private mode throws on access, embedded
 * webviews can block it, and a quota error can hit on write. Every path here
 * falls back to simply probing again, which is correct, just not free.
 */
function readCache(): Capabilities | null {
  try {
    const raw = (globals.sessionStorage as Storage | undefined)?.getItem(CAPABILITIES_CACHE_KEY)
    if (raw === null || raw === undefined) return null

    const parsed: unknown = JSON.parse(raw)
    return isCapabilities(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeCache(caps: Capabilities): void {
  try {
    ;(globals.sessionStorage as Storage | undefined)?.setItem(
      CAPABILITIES_CACHE_KEY,
      JSON.stringify(caps),
    )
  } catch {
    // Nothing to do: the probe already produced an answer.
  }
}

const PLATFORMS: readonly Platform[] = ['ios', 'android', 'desktop']
const BROWSERS: readonly Browser[] = ['safari', 'chromium', 'firefox', 'unknown']

/**
 * A cache entry is untrusted input — it survives reloads and anyone can edit it
 * in devtools. Every field is checked, so a truncated or tampered entry causes a
 * re-probe instead of handing the memory budget a `platform` it cannot price.
 */
function isCapabilities(value: unknown): value is Capabilities {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>

  const booleans = [
    'crossOriginIsolated',
    'wasmSimd',
    'webCodecsVideo',
    'webCodecsAudio',
    'offscreenCanvas',
    'createImageBitmap',
  ]
  if (!booleans.every((key) => typeof c[key] === 'boolean')) return false

  const numbers = ['deviceMemoryGb', 'cores']
  if (!numbers.every((key) => typeof c[key] === 'number' && Number.isFinite(c[key]))) return false

  return PLATFORMS.includes(c.platform as Platform) && BROWSERS.includes(c.browser as Browser)
}
