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
  IOS_BUDGET_BYTES,
  MEMORY,
  budgetBytes,
  fitsInBudget,
  heldBytes,
  maxHeldBytes,
  maxInputBytes,
  peakBytes,
} from '@/lib/router/budget'
import { jobInput } from '@/lib/router/job'
import type { Capabilities, EngineId, EngineMemory } from '@/lib/router/types'

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
 * The nine engines, listed independently of `MEMORY` so the completeness
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

describe('MEMORY', () => {
  it('covers every EngineId', () => {
    // Compile-time half: the list is exactly EngineId, so it cannot drift.
    expectTypeOf<(typeof ALL_ENGINES)[number]>().toEqualTypeOf<EngineId>()

    // Runtime half: the table has a model for each of them and nothing else.
    expect(Object.keys(MEMORY).sort()).toEqual([...ALL_ENGINES].sort())
  })

  it('pins every measured model, so none can drift without a deliberate change', () => {
    expect(MEMORY).toEqual({
      canvas: { factor: 6, holds: 'one-at-a-time', reserveBytes: 0 },
      vips: { factor: 4, holds: 'one-at-a-time', reserveBytes: 0 },
      heif: { factor: 5, holds: 'one-at-a-time', reserveBytes: 0 },
      pdflib: { factor: 4, holds: 'all-at-once', reserveBytes: 32 * MB },
      pdfjs: { factor: 4, holds: 'one-at-a-time', reserveBytes: 32 * MB },
      webcodecs: { factor: 2.5, holds: 'one-at-a-time', reserveBytes: 0 },
      ffmpeg: { factor: 4.5, holds: 'one-at-a-time', reserveBytes: 0 },
      zip: { factor: 2.5, holds: 'all-at-once', reserveBytes: 0 },
      libarchive: { factor: 3, holds: 'one-at-a-time', reserveBytes: 0 },
    })
  })

  it('assigns every engine a factor of at least 1 and a non-negative reserve', () => {
    for (const engine of ALL_ENGINES) {
      expect(MEMORY[engine].factor).toBeGreaterThanOrEqual(1)
      expect(Number.isFinite(MEMORY[engine].factor)).toBe(true)
      expect(MEMORY[engine].reserveBytes).toBeGreaterThanOrEqual(0)
      expect(Number.isInteger(MEMORY[engine].reserveBytes)).toBe(true)
    }
  })

  it('keeps every reserve well under the smallest platform budget', () => {
    // A reserve at or above the smallest budget makes the engine unroutable on
    // that platform *and* makes the rejection quote a ceiling of zero bytes,
    // which is a sentence with no action in it. Half of the iOS budget leaves
    // an engine with a real allowance on the weakest device we support.
    for (const engine of ALL_ENGINES) {
      expect(MEMORY[engine].reserveBytes).toBeLessThan(IOS_BUDGET_BYTES / 2)
    }
  })

  it('holds every file at once only where the engine really opens them together', () => {
    // Merge builds one object graph out of every source, and a ZIP is written
    // from every member; everything else works through one file at a time.
    const together = ALL_ENGINES.filter((engine) => MEMORY[engine].holds === 'all-at-once')

    expect(together).toEqual(['pdflib', 'zip'])
  })

  it('makes the streaming engines cheaper than the buffering ones', () => {
    // WebCodecs streams frames; ffmpeg.wasm holds input, output and scratch in MEMFS.
    expect(MEMORY.webcodecs.factor).toBeLessThan(MEMORY.ffmpeg.factor)
    // A decoded RGBA bitmap dwarfs the encoded bytes it came from.
    expect(MEMORY.canvas.factor).toBeGreaterThan(MEMORY.vips.factor)
  })

  it('gives a reserve only to the engines that allocate by something other than input size', () => {
    // pdf.js sizes its canvas from the requested DPI and pdf-lib's object graph
    // costs the same on a 13 kB document as the library itself does. Every
    // other engine's peak is described by the input alone.
    const reserved = ALL_ENGINES.filter((engine) => MEMORY[engine].reserveBytes > 0)

    expect(reserved).toEqual(['pdflib', 'pdfjs'])
  })

  it('rejects an engine that is not in the union', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    const model = MEMORY.imagemagick

    expect(model).toBeUndefined()
  })
})

describe('heldBytes', () => {
  const job = jobInput([5 * MB, MB, 3 * MB])

  it('adds every file up for an engine that opens them together', () => {
    expect(heldBytes({ factor: 4, holds: 'all-at-once', reserveBytes: 0 }, job)).toBe(9 * MB)
  })

  it('takes only the largest for an engine that works through them one by one', () => {
    expect(heldBytes({ factor: 4, holds: 'one-at-a-time', reserveBytes: 0 }, job)).toBe(5 * MB)
  })

  it('answers the same for both models on a single-file job', () => {
    const one = jobInput(4 * MB)

    expect(heldBytes({ factor: 4, holds: 'all-at-once', reserveBytes: 0 }, one)).toBe(4 * MB)
    expect(heldBytes({ factor: 4, holds: 'one-at-a-time', reserveBytes: 0 }, one)).toBe(4 * MB)
  })
})

describe('peakBytes', () => {
  it('is the proportional term plus the reserve', () => {
    const model: EngineMemory = { factor: 4, holds: 'all-at-once', reserveBytes: 32 * MB }

    expect(peakBytes(model, jobInput([10 * MB, 10 * MB]))).toBe(112 * MB)
  })

  it('is the reserve alone for an engine that holds nothing proportional', () => {
    const model: EngineMemory = { factor: 1, holds: 'one-at-a-time', reserveBytes: 8 * MB }

    expect(peakBytes(model, jobInput([]))).toBe(8 * MB)
  })

  it('rises with the file count only when the engine holds them all', () => {
    const together: EngineMemory = { factor: 2, holds: 'all-at-once', reserveBytes: 0 }
    const oneByOne: EngineMemory = { factor: 2, holds: 'one-at-a-time', reserveBytes: 0 }
    const hundred = jobInput(Array.from({ length: 100 }, () => MB))

    expect(peakBytes(together, hundred)).toBe(200 * MB)
    expect(peakBytes(oneByOne, hundred)).toBe(2 * MB)
  })
})

describe('maxHeldBytes', () => {
  it('spends the budget that the reserve leaves', () => {
    expect(maxHeldBytes({ factor: 4, holds: 'all-at-once', reserveBytes: 32 * MB }, 132 * MB)).toBe(
      25 * MB,
    )
  })

  it('never answers below zero, however large the reserve is', () => {
    expect(
      maxHeldBytes({ factor: 4, holds: 'one-at-a-time', reserveBytes: 200 * MB }, 90 * MB),
    ).toBe(0)
  })
})

describe('maxInputBytes', () => {
  it('divides the platform budget by the engine expansion factor', () => {
    // 90 MB / 4.5 = exactly 20 MB of ffmpeg input on an iPhone.
    expect(maxInputBytes('ffmpeg', ios)).toBe(20 * MB)
    // 140 MB / 2.5 = 56 MB of WebCodecs input on Android.
    expect(maxInputBytes('webcodecs', android)).toBe(56 * MB)
  })

  it('takes the reserve off the top before dividing', () => {
    // (1200 − 32) / 4 = 292 MB of PDF, across every file of a merge.
    expect(maxInputBytes('pdflib', desktop)).toBe(292 * MB)
    // (90 − 32) / 4 = 14.5 MB on an iPhone.
    expect(maxInputBytes('pdfjs', ios)).toBe(14.5 * MB)
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

    expect(fitsInBudget('ffmpeg', jobInput(limit), ios)).toBe(true)
    expect(fitsInBudget('ffmpeg', jobInput(limit + 1), ios)).toBe(false)
  })

  it('accepts a 50 MB video on desktop WebCodecs but refuses 200 MB on iOS ffmpeg', () => {
    expect(fitsInBudget('webcodecs', jobInput(50 * MB), desktop)).toBe(true)
    expect(fitsInBudget('ffmpeg', jobInput(200 * MB), ios)).toBe(false)
  })

  it('adds a merge up rather than looking at one file at a time', () => {
    // A hundred 50 MB scans is the case the file-count ceiling in pdf-merge
    // cannot see: every file is comfortably small and the job is 4.9 GB.
    const hundredScans = jobInput(Array.from({ length: 100 }, () => 50 * MB))

    expect(fitsInBudget('pdflib', jobInput(50 * MB), desktop)).toBe(true)
    expect(fitsInBudget('pdflib', hundredScans, desktop)).toBe(false)
  })

  it('lets a one-at-a-time engine take a long list of small files', () => {
    const hundredPhotos = jobInput(Array.from({ length: 100 }, () => 8 * MB))

    expect(fitsInBudget('canvas', hundredPhotos, desktop)).toBe(true)
  })

  it("treats an empty input as fitting — EMPTY_INPUT is the router's call, not the budget's", () => {
    expect(fitsInBudget('canvas', jobInput(0), desktop)).toBe(true)
  })
})
