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
 * `i8x16.splat` (`0xfd 0x0f`). An engine without the SIMD proposal cannot type
 * the `v128` result and fails to validate it.
 *
 * This is the module from GoogleChromeLabs/wasm-feature-detect. Validating is
 * enough — the module is never instantiated, so the probe costs microseconds
 * and cannot throw on an engine that parses but refuses to compile SIMD.
 *
 * Pinned to `ArrayBuffer` rather than the default `ArrayBufferLike`, so the
 * bytes satisfy `BufferSource` and can be handed straight to `WebAssembly`.
 */
export const WASM_SIMD_PROBE_MODULE: Uint8Array<ArrayBuffer> = new Uint8Array([
  0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15,
  253, 98, 11,
])

/**
 * Versioned so that adding a field to `Capabilities` cannot be satisfied by a
 * cache entry written before that field existed.
 */
export const CAPABILITIES_CACHE_KEY = 'docify.capabilities.v1'

/**
 * More simultaneous touches than any plausible desktop peripheral reports.
 * iPadOS reports 5; a Mac reports 0.
 */
const TABLET_TOUCH_POINT_THRESHOLD = 2

/** Used when the browser will not say. Deliberately pessimistic. */
const FALLBACK_CORES = 2
const FALLBACK_MEMORY_GB_DESKTOP = 4
const FALLBACK_MEMORY_GB_MOBILE = 2

/**
 * Tokens that positively identify a desktop operating system.
 *
 * `Platform` has no `unknown` member, so an unrecognised agent has to be
 * *called* `desktop` — but it must not also be *paid* like one. See
 * `fallbackMemoryGb`.
 */
const DESKTOP_OS = /Windows NT|Macintosh|CrOS|X11|Linux/

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
  const platform = detectPlatform(ua, maxTouchPoints)

  // Apple permits only WebKit on iOS, so Chrome (`CriOS`), Firefox (`FxiOS`),
  // Edge (`EdgiOS`) and every in-app webview there run Safari's engine, with
  // Safari's codecs and Safari's memory ceiling. The router needs to know what
  // will run the job, not whose icon the user tapped — so iOS is always
  // `safari`, regardless of the brand token in the string.
  const browser = platform === 'ios' ? 'safari' : detectBrowser(ua)

  return { platform, browser }
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
  if (/Macintosh/.test(ua) && maxTouchPoints > TABLET_TOUCH_POINT_THRESHOLD) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

/** Reports the rendering engine, not the brand. Only ever reached off iOS. */
function detectBrowser(ua: string): Browser {
  if (/Firefox\//.test(ua)) return 'firefox'
  // Must precede the Safari check: Chromium and Edge UAs both end in `Safari/`.
  // `Edg/` is redundant today — every Edge UA also carries `Chrome/` — but it is
  // kept so the intent survives a future Edge that drops the Chrome token.
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
 * Everything that is a property of the *device*, and therefore constant for as
 * long as the tab lives. This is the part that is worth caching.
 */
type DeviceCapabilities = Omit<Capabilities, 'crossOriginIsolated'>

/**
 * Reads this device's capabilities.
 *
 * Client-only: call it from the UI and pass the result down. Never call it from
 * the router — see the module comment.
 */
export function probeCapabilities(): Capabilities {
  // Read live, every call, and deliberately kept out of the cache. Cross-origin
  // isolation is a property of the *document*, not the device: `next.config.ts`
  // sends COOP/COEP on `/convert/*` and `/tools/*` only, so it flips as the user
  // navigates between marketing and converter routes while sessionStorage
  // survives the whole tab. Caching it would either deny ffmpeg.wasm its threads
  // on an isolated page, or promise it a SharedArrayBuffer that is not there.
  const crossOriginIsolated = globalThis.crossOriginIsolated === true

  const cached = readCache()
  if (cached) return { ...cached, crossOriginIsolated }

  const device = probeDevice()
  writeCache(device)
  return { ...device, crossOriginIsolated }
}

function probeDevice(): DeviceCapabilities {
  const nav = (globals.navigator ?? {}) as ProbeNavigator
  const ua = nav.userAgent ?? ''
  const { platform, browser } = parseUserAgent(ua, nav.maxTouchPoints ?? 0)

  return {
    wasmSimd: detectWasmSimd(),
    deviceMemoryGb: positiveOr(nav.deviceMemory, fallbackMemoryGb(platform, ua)),
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

/**
 * `deviceMemory` is Chromium-only, so Safari, Firefox and everything unusual
 * land here. The desktop estimate is granted only to agents that name a desktop
 * OS: under the plan's budget it is worth ~819 MB, against 140 MB for Android
 * and 90 MB for iOS, and handing that to a device nobody recognised is exactly
 * the optimism this module exists to avoid.
 */
function fallbackMemoryGb(platform: Platform, ua: string): number {
  return platform === 'desktop' && DESKTOP_OS.test(ua)
    ? FALLBACK_MEMORY_GB_DESKTOP
    : FALLBACK_MEMORY_GB_MOBILE
}

function hasGlobalFunction(name: string): boolean {
  return typeof globals[name] === 'function'
}

/** A count a browser reports must be usable: 0, NaN and negatives are not. */
function isPositiveNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function positiveOr(value: number | undefined, fallback: number): number {
  return isPositiveNumber(value) ? value : fallback
}

/**
 * The device cannot change mid-session, so one probe per tab is enough — but the
 * storage itself is optional. Safari in private mode throws on access, embedded
 * webviews can block it, and a quota error can hit on write. Every path here
 * falls back to simply probing again, which is correct, just not free.
 */
function readCache(): DeviceCapabilities | null {
  try {
    const raw = (globals.sessionStorage as Storage | undefined)?.getItem(CAPABILITIES_CACHE_KEY)
    if (raw === null || raw === undefined) return null

    const parsed: unknown = JSON.parse(raw)
    return isDeviceCapabilities(parsed) ? parsed : null
  } catch {
    return null
  }
}

function writeCache(device: DeviceCapabilities): void {
  try {
    ;(globals.sessionStorage as Storage | undefined)?.setItem(
      CAPABILITIES_CACHE_KEY,
      JSON.stringify(device),
    )
  } catch {
    // Nothing to do: the probe already produced an answer.
  }
}

const PLATFORMS: readonly string[] = ['ios', 'android', 'desktop']
const BROWSERS: readonly string[] = ['safari', 'chromium', 'firefox', 'unknown']

/**
 * A cache entry is untrusted input — it survives reloads and anyone can edit it
 * in devtools. Every field is checked against the same rules the fresh probe
 * enforces, so a truncated or tampered entry causes a re-probe rather than
 * handing the memory budget a negative core count or a `platform` it cannot
 * price.
 */
function isDeviceCapabilities(value: unknown): value is DeviceCapabilities {
  if (typeof value !== 'object' || value === null) return false
  const c = value as Record<string, unknown>

  const booleans = [
    'wasmSimd',
    'webCodecsVideo',
    'webCodecsAudio',
    'offscreenCanvas',
    'createImageBitmap',
  ]
  if (!booleans.every((key) => typeof c[key] === 'boolean')) return false

  if (!isPositiveNumber(c.deviceMemoryGb) || !isPositiveNumber(c.cores)) return false

  return (
    typeof c.platform === 'string' &&
    PLATFORMS.includes(c.platform) &&
    typeof c.browser === 'string' &&
    BROWSERS.includes(c.browser)
  )
}
