// @vitest-environment node
//
// Deliberately not jsdom. The budget model must be a pure function of the
// `Capabilities` it is handed — it runs during SSR and inside a Web Worker,
// where there is no `window` and no `navigator`. Running this suite without a
// DOM turns that invariant into a test failure instead of a production bug.

import { describe, expect, expectTypeOf, it } from 'vitest'

import {
  ANDROID_BUDGET_BYTES,
  DESKTOP_BUDGET_CAP_BYTES,
  DESKTOP_BUDGET_FLOOR_BYTES,
  DESKTOP_MEMORY_SHARE,
  EXPANSION,
  IOS_BUDGET_BYTES,
  budgetBytes,
  fitsInBudget,
  maxInputBytes,
} from '@/lib/router/budget'
import type { Capabilities, EngineId } from '@/lib/router/types'

const MB = 1024 * 1024
const GB = 1024 * MB

/** A plain desktop device. Every other profile below is a spread of this one. */
const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const ios: Capabilities = {
  ...desktop,
  crossOriginIsolated: false,
  deviceMemoryGb: 2,
  cores: 4,
  webCodecsVideo: false,
  webCodecsAudio: false,
  platform: 'ios',
  browser: 'safari',
}

const android: Capabilities = {
  ...desktop,
  deviceMemoryGb: 4,
  cores: 6,
  platform: 'android',
  browser: 'chromium',
}

/**
 * The nine engines, listed independently of `EXPANSION` so the completeness
 * assertion below compares two sources rather than the table against itself.
 */
const ALL_ENGINES = [
  'canvas',
  'vips',
  'heif',
  'pdflib',
  'pdfjs',
  'webcodecs',
  'ffmpeg',
  'zip',
  'libarchive',
] as const

/** Device memory at which the derived desktop budget first reaches the cap. */
const CAP_TRANSITION_GB = DESKTOP_BUDGET_CAP_BYTES / DESKTOP_MEMORY_SHARE / GB

/** Device memory at which the derived desktop budget first beats the floor. */
const FLOOR_TRANSITION_GB = DESKTOP_BUDGET_FLOOR_BYTES / DESKTOP_MEMORY_SHARE / GB

describe('budgetBytes', () => {
  it('gives iOS exactly 90 MB, because Safari kills tabs well before the OS limit', () => {
    expect(budgetBytes(ios)).toBe(90 * MB)
    expect(IOS_BUDGET_BYTES).toBe(90 * MB)
  })

  it('gives Android exactly 140 MB', () => {
    expect(budgetBytes(android)).toBe(140 * MB)
    expect(ANDROID_BUDGET_BYTES).toBe(140 * MB)
  })

  it('ignores reported device memory on mobile — the ceiling is the browser, not the RAM', () => {
    expect(budgetBytes({ ...ios, deviceMemoryGb: 64 })).toBe(90 * MB)
    expect(budgetBytes({ ...android, deviceMemoryGb: 64 })).toBe(140 * MB)
  })

  it('derives the desktop budget from a fixed share of device memory', () => {
    // 2 GB × 0.2 = 409.6 MB → 429496729 bytes, floored. Written as a literal
    // rather than as the formula, so the test cannot drift with the code.
    expect(budgetBytes({ ...desktop, deviceMemoryGb: 2 })).toBe(429496729)
    expect(budgetBytes({ ...desktop, deviceMemoryGb: 5 })).toBe(1024 * MB)
    expect(DESKTOP_MEMORY_SHARE).toBe(0.2)
  })

  it('caps the desktop budget at 1200 MB whatever the machine reports', () => {
    // 8 GB × 0.2 = 1638 MB, so the wasm32 heap cap is what actually binds.
    expect(budgetBytes(desktop)).toBe(1200 * MB)
    expect(budgetBytes({ ...desktop, deviceMemoryGb: 128 })).toBe(1200 * MB)
    expect(DESKTOP_BUDGET_CAP_BYTES).toBe(1200 * MB)
  })

  it('switches to the cap exactly where the derived value reaches it', () => {
    // The cap starts binding at 1200 MB / 0.2 = 5.859375 GB, not at a round
    // number of gigabytes — so that is where the transition must be probed.
    expect(budgetBytes({ ...desktop, deviceMemoryGb: CAP_TRANSITION_GB })).toBe(
      DESKTOP_BUDGET_CAP_BYTES,
    )
    expect(budgetBytes({ ...desktop, deviceMemoryGb: CAP_TRANSITION_GB * 1.001 })).toBe(
      DESKTOP_BUDGET_CAP_BYTES,
    )
    // A hair below, the derived value must survive rather than be rounded up.
    expect(budgetBytes({ ...desktop, deviceMemoryGb: CAP_TRANSITION_GB * 0.999 })).toBeLessThan(
      DESKTOP_BUDGET_CAP_BYTES,
    )
  })

  it('floors the desktop budget so a tiny deviceMemory reading cannot starve it', () => {
    // navigator.deviceMemory is clamped to 0.25 at the low end; 0.25 GB × 0.2 is
    // only 51 MB, which would make a desktop weaker than a phone.
    expect(budgetBytes({ ...desktop, deviceMemoryGb: 0.25 })).toBe(DESKTOP_BUDGET_FLOOR_BYTES)
    expect(DESKTOP_BUDGET_FLOOR_BYTES).toBe(140 * MB)
  })

  it('stops flooring exactly where the derived value overtakes the floor', () => {
    // The floor stops binding at 140 MB / 0.2 = 0.68359375 GB.
    expect(budgetBytes({ ...desktop, deviceMemoryGb: FLOOR_TRANSITION_GB })).toBe(
      DESKTOP_BUDGET_FLOOR_BYTES,
    )
    expect(budgetBytes({ ...desktop, deviceMemoryGb: FLOOR_TRANSITION_GB * 0.999 })).toBe(
      DESKTOP_BUDGET_FLOOR_BYTES,
    )
    expect(budgetBytes({ ...desktop, deviceMemoryGb: FLOOR_TRANSITION_GB * 1.01 })).toBeGreaterThan(
      DESKTOP_BUDGET_FLOOR_BYTES,
    )
  })

  it('falls back to the floor when deviceMemory is missing or nonsensical', () => {
    expect(budgetBytes({ ...desktop, deviceMemoryGb: 0 })).toBe(DESKTOP_BUDGET_FLOOR_BYTES)
    expect(budgetBytes({ ...desktop, deviceMemoryGb: -4 })).toBe(DESKTOP_BUDGET_FLOOR_BYTES)
    expect(budgetBytes({ ...desktop, deviceMemoryGb: Number.NaN })).toBe(DESKTOP_BUDGET_FLOOR_BYTES)
  })

  it('never returns a fractional byte count', () => {
    for (const gb of [0.25, 1, 1.5, 3, 4, 5, 8]) {
      expect(Number.isInteger(budgetBytes({ ...desktop, deviceMemoryGb: gb }))).toBe(true)
    }
  })

  it('is deterministic — the same capabilities always give the same number', () => {
    // The purity half of the contract is enforced by the file-level
    // `@vitest-environment node` pragma above: with no DOM in scope, any
    // navigator/window read inside the module would throw here rather than
    // silently pass under jsdom and only fail during SSR.
    expect(budgetBytes(desktop)).toBe(budgetBytes({ ...desktop }))
    expect(budgetBytes(ios)).toBe(budgetBytes({ ...ios }))
  })
})

describe('EXPANSION', () => {
  it('covers every EngineId', () => {
    // Compile-time half: the list is exactly EngineId, so it cannot drift.
    expectTypeOf<(typeof ALL_ENGINES)[number]>().toEqualTypeOf<EngineId>()

    // Runtime half: the table has a factor for each of them and nothing else.
    expect(Object.keys(EXPANSION).sort()).toEqual([...ALL_ENGINES].sort())
  })

  it('pins every measured factor, so none can drift without a deliberate change', () => {
    expect(EXPANSION).toEqual({
      canvas: 6,
      vips: 4,
      heif: 5,
      pdflib: 3,
      pdfjs: 4,
      webcodecs: 2.5,
      ffmpeg: 4.5,
      zip: 2.5,
      libarchive: 3,
    })
  })

  it('assigns every engine a factor of at least 1', () => {
    for (const engine of ALL_ENGINES) {
      expect(EXPANSION[engine]).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(EXPANSION[engine])).toBe(true)
    }
  })

  it('makes the streaming engines cheaper than the buffering ones', () => {
    // WebCodecs streams frames; ffmpeg.wasm holds input, output and scratch in MEMFS.
    expect(EXPANSION.webcodecs).toBeLessThan(EXPANSION.ffmpeg)
    // A decoded RGBA bitmap dwarfs the encoded bytes it came from.
    expect(EXPANSION.canvas).toBeGreaterThan(EXPANSION.vips)
  })

  it('rejects an engine that is not in the union', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    const factor = EXPANSION.imagemagick

    expect(factor).toBeUndefined()
  })
})

describe('maxInputBytes', () => {
  it('divides the platform budget by the engine expansion factor', () => {
    // 90 MB / 4.5 = exactly 20 MB of ffmpeg input on an iPhone.
    expect(maxInputBytes('ffmpeg', ios)).toBe(20 * MB)
    // 140 MB / 2.5 = 56 MB of WebCodecs input on Android.
    expect(maxInputBytes('webcodecs', android)).toBe(56 * MB)
  })

  it('returns whole bytes', () => {
    for (const engine of ALL_ENGINES) {
      expect(Number.isInteger(maxInputBytes(engine, desktop))).toBe(true)
    }
  })

  it('lets a cheaper engine accept a larger file on the same device', () => {
    expect(maxInputBytes('webcodecs', desktop)).toBeGreaterThan(maxInputBytes('ffmpeg', desktop))
  })

  it('lets the same engine accept a larger file on a desktop than on a phone', () => {
    expect(maxInputBytes('ffmpeg', desktop)).toBeGreaterThan(maxInputBytes('ffmpeg', ios))
    expect(maxInputBytes('ffmpeg', android)).toBeGreaterThan(maxInputBytes('ffmpeg', ios))
  })
})

describe('fitsInBudget', () => {
  it('accepts a file exactly on the limit and rejects the next byte', () => {
    const limit = maxInputBytes('ffmpeg', ios)

    expect(fitsInBudget('ffmpeg', limit, ios)).toBe(true)
    expect(fitsInBudget('ffmpeg', limit + 1, ios)).toBe(false)
  })

  it('accepts a 50 MB video on desktop WebCodecs but refuses 200 MB on iOS ffmpeg', () => {
    expect(fitsInBudget('webcodecs', 50 * MB, desktop)).toBe(true)
    expect(fitsInBudget('ffmpeg', 200 * MB, ios)).toBe(false)
  })

  it("treats an empty input as fitting — EMPTY_INPUT is the router's call, not the budget's", () => {
    expect(fitsInBudget('canvas', 0, desktop)).toBe(true)
  })
})
