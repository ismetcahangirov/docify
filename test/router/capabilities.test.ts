import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  CAPABILITIES_CACHE_KEY,
  WASM_SIMD_PROBE_MODULE,
  detectWasmSimd,
  parseUserAgent,
  probeCapabilities,
} from '@/lib/router/capabilities'
import type { Capabilities } from '@/lib/router/types'

/**
 * Real user agents, captured from the devices the router has to survive on.
 * They are verbatim on purpose: a "simplified" UA string proves nothing about
 * the regexes, because the hard part is the substrings that overlap
 * (every Chromium UA also contains `Safari/`, and iPadOS pretends to be macOS).
 */
const UA = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5_1 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) CriOS/125.0.6422.80 Mobile/15E148 Safari/604.1',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) FxiOS/126.0 Mobile/15E148 Safari/605.1.15',
  /** Facebook's in-app browser: no `Safari/` token anywhere in the string. */
  iphoneFacebook:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/468.0.0.35.107]',
  ipadLegacy:
    'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  /** iPadOS 13+ and macOS Safari send byte-identical strings. */
  macLikeSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  /** Chrome on an iPad with "Request Desktop Site" on — still WebKit. */
  ipadDesktopModeChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.6422.72 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/AP1A.240505.004; wv) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Version/4.0 Chrome/125.0.6422.72 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S928B) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51',
  desktopOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 OPR/111.0.0.0',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  headlessChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) HeadlessChrome/125.0.0.0 Safari/537.36',
  /** A feature phone: names no desktop OS, so it must not be priced as one. */
  kaiOs: 'Mozilla/5.0 (Mobile; LYF/F90M/LYF-F90M; rv:48.0) Gecko/48.0 Firefox/48.0 KAIOS/2.5',
  unknown: 'curl/8.7.1',
} as const

describe('parseUserAgent', () => {
  it('classifies with no browser, no storage and no WebAssembly present', () => {
    vi.stubGlobal('navigator', undefined)
    vi.stubGlobal('sessionStorage', undefined)
    vi.stubGlobal('WebAssembly', undefined)

    expect(parseUserAgent(UA.desktopChrome)).toEqual({
      platform: 'desktop',
      browser: 'chromium',
    })

    vi.unstubAllGlobals()
  })

  describe('iOS', () => {
    it('detects an iPhone running Safari', () => {
      expect(parseUserAgent(UA.iphoneSafari)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    it('detects a legacy iPad that still announces itself as an iPad', () => {
      expect(parseUserAgent(UA.ipadLegacy)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    it('detects iPadOS 13+ behind its desktop-class user agent, via touch points', () => {
      expect(parseUserAgent(UA.macLikeSafari, 5)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    // Apple permits only WebKit on iOS, so the brand token in the string says
    // nothing about the engine that will run the job. Every one of these has
    // Safari's codecs and Safari's memory ceiling, and the router branches on
    // `browser === 'safari'` to honour them.
    it.each([
      ['Chrome (CriOS)', UA.iphoneChrome, 0],
      ['Firefox (FxiOS)', UA.iphoneFirefox, 0],
      ["Facebook's in-app browser", UA.iphoneFacebook, 0],
      ['Chrome on iPadOS in desktop-site mode', UA.ipadDesktopModeChrome, 5],
    ])('reports %s as Safari, because it is WebKit underneath', (_name, ua, touchPoints) => {
      expect(parseUserAgent(ua, touchPoints)).toEqual({ platform: 'ios', browser: 'safari' })
    })
  })

  describe('Android', () => {
    it('detects Android Chrome, despite the trailing "Safari/537.36"', () => {
      expect(parseUserAgent(UA.androidChrome)).toEqual({
        platform: 'android',
        browser: 'chromium',
      })
    })

    it('detects Android Firefox', () => {
      expect(parseUserAgent(UA.androidFirefox)).toEqual({
        platform: 'android',
        browser: 'firefox',
      })
    })

    it.each([
      ['an Android WebView', UA.androidWebView],
      ['Samsung Internet', UA.androidSamsung],
    ])('detects %s as chromium', (_name, ua) => {
      expect(parseUserAgent(ua)).toEqual({ platform: 'android', browser: 'chromium' })
    })
  })

  describe('desktop', () => {
    it.each([
      ['Chrome', UA.desktopChrome],
      ['Edge', UA.desktopEdge],
      ['Opera', UA.desktopOpera],
      ['Chrome OS', UA.chromeOs],
      ['headless Chrome', UA.headlessChrome],
    ])('detects %s as chromium, not as Safari', (_name, ua) => {
      expect(parseUserAgent(ua)).toEqual({ platform: 'desktop', browser: 'chromium' })
    })

    it('detects desktop Firefox', () => {
      expect(parseUserAgent(UA.desktopFirefox)).toEqual({
        platform: 'desktop',
        browser: 'firefox',
      })
    })

    it('detects Safari on a real Mac, which reports no touch points', () => {
      expect(parseUserAgent(UA.macLikeSafari, 0)).toEqual({
        platform: 'desktop',
        browser: 'safari',
      })
    })

    it('treats a Mac with a single touch point as a Mac, not an iPad', () => {
      // iPadOS reports 5. A stray 1 is a peripheral, not a tablet.
      expect(parseUserAgent(UA.macLikeSafari, 1)).toEqual({
        platform: 'desktop',
        browser: 'safari',
      })
    })

    it('does not mistake a Windows touchscreen laptop for an iPad', () => {
      // The whole reason the touch-point rule is gated on `Macintosh`.
      expect(parseUserAgent(UA.desktopChrome, 10)).toEqual({
        platform: 'desktop',
        browser: 'chromium',
      })
    })

    it('defaults to zero touch points when the caller passes none', () => {
      expect(parseUserAgent(UA.macLikeSafari)).toEqual({ platform: 'desktop', browser: 'safari' })
    })
  })

  describe('unknown agents', () => {
    it('reports an unrecognised browser rather than guessing', () => {
      expect(parseUserAgent(UA.unknown)).toEqual({ platform: 'desktop', browser: 'unknown' })
    })

    it('survives an empty user agent', () => {
      expect(parseUserAgent('')).toEqual({ platform: 'desktop', browser: 'unknown' })
    })
  })
})

describe('detectWasmSimd', () => {
  it('carries the SIMD markers the probe depends on', () => {
    // A `v128` result type and an `i8x16.splat` opcode are what a non-SIMD
    // engine cannot type. Their positions are asserted rather than the whole
    // array, so this fails on a change of meaning, not on a reformat.
    expect(WASM_SIMD_PROBE_MODULE).toHaveLength(31)
    expect(WASM_SIMD_PROBE_MODULE[14]).toBe(0x7b) // v128
    expect([WASM_SIMD_PROBE_MODULE[26], WASM_SIMD_PROBE_MODULE[27]]).toEqual([0xfd, 0x0f]) // i8x16.splat
  })

  it('is a module this engine accepts', () => {
    // Node 22 supports SIMD, so a `false` here means the bytes are broken,
    // not that the feature is missing.
    expect(WebAssembly.validate(WASM_SIMD_PROBE_MODULE)).toBe(true)
  })

  it('is rejected once the SIMD opcode is corrupted', () => {
    // The control for the assertion above: validation has to actually depend on
    // the SIMD bytes, otherwise the probe would answer "yes" for any module.
    const corrupted = Uint8Array.from(WASM_SIMD_PROBE_MODULE)
    corrupted[26] = 0xdd // no longer the 0xfd SIMD prefix

    expect(WebAssembly.validate(corrupted)).toBe(false)
  })

  it('accepts a bare module header, proving validate is not rejecting everything', () => {
    expect(WebAssembly.validate(Uint8Array.from([0, 97, 115, 109, 1, 0, 0, 0]))).toBe(true)
  })

  it('reports SIMD support on an engine that has it', () => {
    expect(detectWasmSimd()).toBe(true)
  })

  it('hands exactly the probe module to the injected validator', () => {
    const seen: Uint8Array[] = []

    detectWasmSimd((bytes) => {
      seen.push(bytes)
      return true
    })

    expect(seen).toHaveLength(1)
    expect(Array.from(seen[0])).toEqual(Array.from(WASM_SIMD_PROBE_MODULE))
  })

  it('reports true when the validator accepts the module', () => {
    expect(detectWasmSimd(() => true)).toBe(true)
  })

  it('reports false when the validator rejects the module', () => {
    expect(detectWasmSimd(() => false)).toBe(false)
  })

  it('reports false when the validator throws', () => {
    expect(
      detectWasmSimd(() => {
        throw new Error('WebAssembly is disabled by policy')
      }),
    ).toBe(false)
  })

  it('reports false — never true — when WebAssembly itself is missing', () => {
    vi.stubGlobal('WebAssembly', undefined)

    expect(detectWasmSimd()).toBe(false)

    vi.unstubAllGlobals()
  })
})

/** A navigator stub with only the properties the probe is allowed to read. */
function stubNavigator(props: {
  userAgent: string
  hardwareConcurrency?: number
  deviceMemory?: number
  maxTouchPoints?: number
}): void {
  vi.stubGlobal('navigator', props)
}

/** A well-formed cache entry. Deliberately iOS, so a re-probe is distinguishable. */
const CACHED_DEVICE: Omit<Capabilities, 'crossOriginIsolated'> = {
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'ios',
  browser: 'safari',
}

function seedCache(entry: unknown): void {
  sessionStorage.setItem(CAPABILITIES_CACHE_KEY, JSON.stringify(entry))
}

describe('probeCapabilities', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    sessionStorage.clear()
  })

  it('returns every field of Capabilities', () => {
    stubNavigator({ userAgent: UA.desktopChrome })

    const caps = probeCapabilities()

    expect(Object.keys(caps).sort()).toEqual(
      [
        'browser',
        'cores',
        'createImageBitmap',
        'crossOriginIsolated',
        'deviceMemoryGb',
        'offscreenCanvas',
        'platform',
        'wasmSimd',
        'webCodecsAudio',
        'webCodecsVideo',
      ].sort(),
    )
  })

  it('takes platform and browser from the user agent', () => {
    stubNavigator({ userAgent: UA.androidChrome })

    const caps = probeCapabilities()

    expect(caps.platform).toBe('android')
    expect(caps.browser).toBe('chromium')
  })

  it('detects iPadOS through navigator.maxTouchPoints', () => {
    stubNavigator({ userAgent: UA.macLikeSafari, maxTouchPoints: 5 })

    expect(probeCapabilities().platform).toBe('ios')
  })

  describe('conservative fallbacks', () => {
    it('reports every absent feature as unavailable', () => {
      // jsdom has no WebCodecs, no OffscreenCanvas and no createImageBitmap.
      stubNavigator({ userAgent: UA.desktopChrome })

      const caps = probeCapabilities()

      expect(caps.webCodecsVideo).toBe(false)
      expect(caps.webCodecsAudio).toBe(false)
      expect(caps.offscreenCanvas).toBe(false)
      expect(caps.createImageBitmap).toBe(false)
      expect(caps.crossOriginIsolated).toBe(false)
    })

    it('requires BOTH halves of a WebCodecs pair before claiming support', () => {
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('VideoEncoder', function VideoEncoder() {})
      vi.stubGlobal('AudioDecoder', function AudioDecoder() {})

      const caps = probeCapabilities()

      // Encoder without decoder, and decoder without encoder, are both useless.
      expect(caps.webCodecsVideo).toBe(false)
      expect(caps.webCodecsAudio).toBe(false)
    })

    it('reports WebCodecs when both halves are present', () => {
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('VideoEncoder', function VideoEncoder() {})
      vi.stubGlobal('VideoDecoder', function VideoDecoder() {})
      vi.stubGlobal('AudioEncoder', function AudioEncoder() {})
      vi.stubGlobal('AudioDecoder', function AudioDecoder() {})

      const caps = probeCapabilities()

      expect(caps.webCodecsVideo).toBe(true)
      expect(caps.webCodecsAudio).toBe(true)
    })

    it('assumes 4 GB when the agent names a desktop OS but not its memory', () => {
      // deviceMemory is Chromium-only; Safari and Firefox never send it.
      stubNavigator({ userAgent: UA.desktopFirefox })

      expect(probeCapabilities().deviceMemoryGb).toBe(4)
    })

    it('assumes only 2 GB on mobile when navigator.deviceMemory is missing', () => {
      stubNavigator({ userAgent: UA.iphoneSafari })

      expect(probeCapabilities().deviceMemoryGb).toBe(2)
    })

    it.each([
      ['an unrecognised agent', UA.unknown],
      ['a feature phone that names no desktop OS', UA.kaiOs],
      ['an empty user agent', ''],
    ])('assumes the low 2 GB estimate for %s', (_name, userAgent) => {
      // These are all classified `desktop` because Platform has no other value
      // for them — but an unknown device must not be handed the ~819 MB desktop
      // budget on the strength of not being recognised.
      stubNavigator({ userAgent })

      expect(probeCapabilities().deviceMemoryGb).toBe(2)
    })

    it('uses navigator.deviceMemory when the browser reports it', () => {
      stubNavigator({ userAgent: UA.desktopChrome, deviceMemory: 8 })

      expect(probeCapabilities().deviceMemoryGb).toBe(8)
    })

    it('ignores a nonsensical deviceMemory and falls back', () => {
      stubNavigator({ userAgent: UA.desktopChrome, deviceMemory: 0 })

      expect(probeCapabilities().deviceMemoryGb).toBe(4)
    })

    it('assumes 2 cores when navigator.hardwareConcurrency is missing', () => {
      stubNavigator({ userAgent: UA.desktopChrome })

      expect(probeCapabilities().cores).toBe(2)
    })

    it('uses navigator.hardwareConcurrency when it is reported', () => {
      stubNavigator({ userAgent: UA.desktopChrome, hardwareConcurrency: 16 })

      expect(probeCapabilities().cores).toBe(16)
    })

    it('ignores a nonsensical hardwareConcurrency and falls back', () => {
      stubNavigator({ userAgent: UA.desktopChrome, hardwareConcurrency: 0 })

      expect(probeCapabilities().cores).toBe(2)
    })

    it('degrades to an unknown desktop when navigator itself is absent', () => {
      vi.stubGlobal('navigator', undefined)

      const caps = probeCapabilities()

      expect(caps.platform).toBe('desktop')
      expect(caps.browser).toBe('unknown')
      expect(caps.cores).toBe(2)
      expect(caps.deviceMemoryGb).toBe(2)
    })
  })

  describe('cross-origin isolation', () => {
    it('reports the isolation of the current document', () => {
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('crossOriginIsolated', true)

      expect(probeCapabilities().crossOriginIsolated).toBe(true)
    })

    it('is never cached, because it belongs to the document and not the device', () => {
      // next.config.ts sends COOP/COEP on /convert/* and /tools/* only, so a
      // hard navigation between marketing and converter routes flips this while
      // sessionStorage lives on. A cached value would either strip ffmpeg.wasm
      // of its threads or promise it a SharedArrayBuffer that is not there.
      stubNavigator({ userAgent: UA.desktopChrome })
      probeCapabilities()

      expect(JSON.parse(sessionStorage.getItem(CAPABILITIES_CACHE_KEY) ?? '{}')).not.toHaveProperty(
        'crossOriginIsolated',
      )
    })

    it('re-reads isolation even when the rest is served from cache', () => {
      seedCache(CACHED_DEVICE)
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('crossOriginIsolated', true)

      const caps = probeCapabilities()

      expect(caps.crossOriginIsolated).toBe(true)
      expect(caps.platform).toBe('ios') // still the cached device
    })
  })

  describe('sessionStorage cache', () => {
    it('writes the device half of the result under a versioned key', () => {
      stubNavigator({ userAgent: UA.iphoneSafari })

      const device: Record<string, unknown> = { ...probeCapabilities() }
      delete device.crossOriginIsolated

      expect(JSON.parse(sessionStorage.getItem(CAPABILITIES_CACHE_KEY) ?? 'null')).toEqual(device)
    })

    it('serves the cached result instead of probing again', () => {
      seedCache(CACHED_DEVICE)
      // The device cannot change mid-session, so a desktop navigator must not
      // change the answer — that is the observable proof the cache was read.
      stubNavigator({ userAgent: UA.desktopChrome })

      expect(probeCapabilities().platform).toBe('ios')
    })

    it.each([
      ['is not JSON', 'not json at all'],
      ['is JSON but not an object', '42'],
      ['is null', 'null'],
    ])('re-probes when the cached entry %s', (_name, raw) => {
      sessionStorage.setItem(CAPABILITIES_CACHE_KEY, raw)
      stubNavigator({ userAgent: UA.androidChrome })

      expect(probeCapabilities().platform).toBe('android')
    })

    it.each([
      ['a field is missing', { ...CACHED_DEVICE, cores: undefined }],
      ['a boolean is the wrong type', { ...CACHED_DEVICE, wasmSimd: 'yes' }],
      ['platform is outside its union', { ...CACHED_DEVICE, platform: 'windows-phone' }],
      ['browser is outside its union', { ...CACHED_DEVICE, browser: 'netscape' }],
      // These would survive a bare `typeof === 'number'` check and then hand the
      // memory budget a negative ceiling, rejecting every job with an absurd
      // message. The fresh probe rejects them, so the cache must too.
      ['cores is zero', { ...CACHED_DEVICE, cores: 0 }],
      ['deviceMemoryGb is negative', { ...CACHED_DEVICE, deviceMemoryGb: -1 }],
      ['a number is NaN', { ...CACHED_DEVICE, deviceMemoryGb: Number.NaN }],
    ])('re-probes when %s', (_name, entry) => {
      seedCache(entry)
      stubNavigator({ userAgent: UA.androidChrome })

      expect(probeCapabilities().platform).toBe('android')
    })

    it('still returns capabilities when sessionStorage throws on read', () => {
      // Safari in private mode, and any browser with storage blocked.
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('sessionStorage', {
        getItem() {
          throw new DOMException('SecurityError')
        },
        setItem() {},
      })

      expect(probeCapabilities().platform).toBe('desktop')
    })

    it('still returns capabilities when sessionStorage throws on write', () => {
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('sessionStorage', {
        getItem: () => null,
        setItem() {
          throw new DOMException('QuotaExceededError')
        },
      })

      expect(probeCapabilities().platform).toBe('desktop')
    })

    it('still returns capabilities when sessionStorage does not exist', () => {
      stubNavigator({ userAgent: UA.desktopChrome })
      vi.stubGlobal('sessionStorage', undefined)

      expect(probeCapabilities().platform).toBe('desktop')
    })
  })
})

/** Drops comments so a doc comment naming the probe is not read as a call. */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '')
}

/**
 * Walks up to the directory holding package.json. `import.meta.url` is not a
 * file URL under the jsdom environment, so the repository has to be located
 * rather than derived from this file.
 */
function repoRoot(): string {
  let dir = process.cwd()
  while (!existsSync(join(dir, 'package.json'))) {
    const parent = dirname(dir)
    if (parent === dir) throw new Error(`No package.json above ${process.cwd()}`)
    dir = parent
  }
  return dir
}

describe('router isolation', () => {
  it('is never imported by any other module in lib/router', () => {
    // CLAUDE.md §5.1: Capabilities is always a parameter. The moment the router
    // imports the probe, its tests need a browser and SSR breaks — so this is
    // asserted against the source itself rather than left to review.
    const routerDir = join(repoRoot(), 'lib', 'router')
    const offenders = readdirSync(routerDir, { recursive: true, encoding: 'utf8' })
      .filter((file) => file.endsWith('.ts') && basename(file) !== 'capabilities.ts')
      .filter((file) =>
        /probeCapabilities|['"](?:\.{1,2}\/|@\/lib\/router\/)capabilities(?:\.js)?['"]/.test(
          stripComments(readFileSync(join(routerDir, file), 'utf8')),
        ),
      )

    expect(offenders).toEqual([])
  })
})
