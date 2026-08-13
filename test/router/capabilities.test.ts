import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

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
  ipadLegacy:
    'Mozilla/5.0 (iPad; CPU OS 12_5_7 like Mac OS X) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/12.1.2 Mobile/15E148 Safari/604.1',
  /** iPadOS 13+ and macOS Safari send byte-identical strings. */
  macLikeSafari:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 ' +
    '(KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.6422.72 Mobile Safari/537.36',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:126.0) Gecko/126.0 Firefox/126.0',
  desktopChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36',
  desktopEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ' +
    '(KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36 Edg/125.0.2535.51',
  desktopFirefox:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:126.0) Gecko/20100101 Firefox/126.0',
  unknown: 'curl/8.7.1',
} as const

describe('parseUserAgent', () => {
  it('is pure — the same string always yields the same answer, with no browser present', () => {
    expect(parseUserAgent(UA.desktopChrome)).toEqual(parseUserAgent(UA.desktopChrome))
  })

  describe('iOS', () => {
    it('detects an iPhone running Safari', () => {
      expect(parseUserAgent(UA.iphoneSafari)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    it('reports Chrome on iOS as Safari, because it is WebKit underneath', () => {
      // CriOS is a WebKit shell: it has exactly Safari's codec and memory
      // limits, so the router must treat it as Safari, not as Chromium.
      expect(parseUserAgent(UA.iphoneChrome)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    it('detects a legacy iPad that still announces itself as an iPad', () => {
      expect(parseUserAgent(UA.ipadLegacy)).toEqual({ platform: 'ios', browser: 'safari' })
    })

    it('detects iPadOS 13+ behind its desktop-class user agent, via touch points', () => {
      expect(parseUserAgent(UA.macLikeSafari, 5)).toEqual({ platform: 'ios', browser: 'safari' })
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
  })

  describe('desktop', () => {
    it('detects desktop Chrome', () => {
      expect(parseUserAgent(UA.desktopChrome)).toEqual({
        platform: 'desktop',
        browser: 'chromium',
      })
    })

    it('detects Edge as chromium, not as Safari', () => {
      expect(parseUserAgent(UA.desktopEdge)).toEqual({ platform: 'desktop', browser: 'chromium' })
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
  it('validates the canonical 31-byte i8x16 module', () => {
    // The module from GoogleChromeLabs/wasm-feature-detect: a function returning
    // v128 via i8x16.splat. Pinned byte-for-byte — an edit here silently turns
    // the probe into a check for something else.
    expect(Array.from(WASM_SIMD_PROBE_MODULE)).toEqual([
      0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253,
      15, 253, 98, 11,
    ])
  })

  it('hands exactly that module to the injected validator', () => {
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

  it('agrees with the host engine when no validator is injected', () => {
    // Node 22 supports SIMD, so this is the one place the real feature probe runs.
    expect(detectWasmSimd()).toBe(WebAssembly.validate(WASM_SIMD_PROBE_MODULE))
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

    it('assumes 4 GB on desktop when navigator.deviceMemory is missing', () => {
      // deviceMemory is Chromium-only; Safari and Firefox never send it.
      stubNavigator({ userAgent: UA.desktopFirefox })

      expect(probeCapabilities().deviceMemoryGb).toBe(4)
    })

    it('assumes only 2 GB on mobile when navigator.deviceMemory is missing', () => {
      stubNavigator({ userAgent: UA.iphoneSafari })

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
    })
  })

  describe('sessionStorage cache', () => {
    it('writes the result under a versioned key', () => {
      stubNavigator({ userAgent: UA.iphoneSafari })

      const caps = probeCapabilities()

      expect(JSON.parse(sessionStorage.getItem(CAPABILITIES_CACHE_KEY) ?? 'null')).toEqual(caps)
    })

    it('serves the cached result instead of probing again', () => {
      stubNavigator({ userAgent: UA.iphoneSafari })
      probeCapabilities()

      // The device cannot change mid-session, so a changed navigator must not
      // change the answer — that is the observable proof the cache was read.
      stubNavigator({ userAgent: UA.desktopChrome })

      expect(probeCapabilities().platform).toBe('ios')
    })

    it('re-probes when the cached entry is corrupt', () => {
      sessionStorage.setItem(CAPABILITIES_CACHE_KEY, 'not json at all')
      stubNavigator({ userAgent: UA.androidChrome })

      expect(probeCapabilities().platform).toBe('android')
    })

    it('re-probes when the cached entry is the wrong shape', () => {
      sessionStorage.setItem(CAPABILITIES_CACHE_KEY, JSON.stringify({ platform: 'desktop' }))
      stubNavigator({ userAgent: UA.androidChrome })

      expect(probeCapabilities().platform).toBe('android')
    })

    it('re-probes when a cached field holds a value outside its union', () => {
      const tampered = { ...probeCapabilitiesFor(UA.desktopChrome), platform: 'windows-phone' }
      sessionStorage.clear()
      sessionStorage.setItem(CAPABILITIES_CACHE_KEY, JSON.stringify(tampered))
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

/** Probes once with a given UA and a clean cache; used to build tampered entries. */
function probeCapabilitiesFor(userAgent: string): Capabilities {
  sessionStorage.clear()
  stubNavigator({ userAgent })
  return probeCapabilities()
}

describe('router isolation', () => {
  it('is never imported by any other module in lib/router', () => {
    // CLAUDE.md §5.1: Capabilities is always a parameter. The moment the router
    // imports the probe, its tests need a browser and SSR breaks — so this is
    // asserted against the source itself rather than left to review.
    const routerDir = join(process.cwd(), 'lib', 'router')
    const offenders = readdirSync(routerDir)
      .filter((file) => file.endsWith('.ts') && file !== 'capabilities.ts')
      .filter((file) =>
        /probeCapabilities|['"](?:\.\/|@\/lib\/router\/)capabilities['"]/.test(
          readFileSync(join(routerDir, file), 'utf8'),
        ),
      )

    expect(offenders).toEqual([])
  })
})
