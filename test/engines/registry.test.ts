import { describe, expect, it } from 'vitest'

import { byPreference, ENGINES, enginesFor, getEngine } from '@/lib/engines/registry'
import type { EngineDescriptor } from '@/lib/engines/types'
import type { Capabilities, ConversionTask } from '@/lib/router/types'

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

const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }

/**
 * Fake descriptors, deliberately not the real engines: ordering is a property of
 * the registry, and asserting it against whichever engines happen to have
 * shipped would turn every new engine into a broken test.
 */
function fake(id: EngineDescriptor['id'], priority: number, loadCost: number): EngineDescriptor {
  return { id, label: id, priority, loadCost, supports: () => true }
}

const order = (engines: readonly EngineDescriptor[]): string[] =>
  [...engines].sort(byPreference).map((engine) => engine.id)

describe('ENGINES', () => {
  it('gives every registered engine a whole set of routing numbers', () => {
    // Deliberately not a list of ids: engines land one issue at a time, and a
    // hard-coded roster would make each new one break this suite. What has to
    // hold is that whatever is registered is routable.
    for (const engine of ENGINES) {
      expect(engine.label.length).toBeGreaterThan(0)
      expect(engine.priority).toBeGreaterThan(0)
      expect(engine.loadCost).toBeGreaterThanOrEqual(0)
      expect(typeof engine.supports).toBe('function')
    }
  })

  it('carries the pdflib engine at the priority the plan gives it', () => {
    expect(getEngine('pdflib')?.priority).toBe(20)
  })

  it('carries the pdfjs engine at the priority the plan gives it', () => {
    expect(getEngine('pdfjs')?.priority).toBe(30)
  })

  it('sends a PDF edit to pdf-lib and a PDF render to pdf.js', () => {
    // The one place the two document engines could collide. They are told apart
    // by direction, not by priority, so a `supports()` that grew a case would
    // be caught here rather than by the user downloading the wrong engine.
    expect(enginesFor({ from: 'pdf', to: 'pdf', op: 'merge' }, desktop).map((e) => e.id)).toEqual([
      'pdflib',
    ])
    expect(enginesFor({ from: 'pdf', to: 'jpg', op: 'convert' }, desktop).map((e) => e.id)).toEqual(
      ['pdfjs'],
    )
  })

  it('carries the heif engine at the priority the plan gives it', () => {
    expect(getEngine('heif')?.priority).toBe(35)
  })

  it('carries the vips engine at the priority the plan gives it', () => {
    expect(getEngine('vips')?.priority).toBe(40)
  })

  it('is frozen, so one consumer cannot reorder the list another is reading', () => {
    expect(Object.isFrozen(ENGINES)).toBe(true)
  })

  it('registers each id at most once', () => {
    expect(new Set(ENGINES.map((engine) => engine.id)).size).toBe(ENGINES.length)
  })
})

describe('byPreference', () => {
  it('orders engines by priority, lowest first', () => {
    const ffmpeg = fake('ffmpeg', 90, 32_000_000)
    const canvas = fake('canvas', 10, 0)
    const vips = fake('vips', 40, 5_500_000)

    expect(order([ffmpeg, vips, canvas])).toEqual(['canvas', 'vips', 'ffmpeg'])
  })

  it('prefers the better priority even when that engine costs far more to download', () => {
    const cheapButLast = fake('ffmpeg', 90, 0)
    const costlyButFirst = fake('canvas', 10, 32_000_000)

    expect(order([cheapButLast, costlyButFirst])).toEqual(['canvas', 'ffmpeg'])
  })

  it('breaks a priority tie with the cheaper download', () => {
    const heavy = fake('vips', 40, 5_500_000)
    const light = fake('heif', 40, 900_000)

    expect(order([heavy, light])).toEqual(['heif', 'vips'])
  })

  it('keeps registration order when priority and load cost are both equal', () => {
    const pdflib = fake('pdflib', 20, 400_000)
    const pdfjs = fake('pdfjs', 20, 400_000)
    const zip = fake('zip', 20, 400_000)

    expect(order([pdflib, pdfjs, zip])).toEqual(['pdflib', 'pdfjs', 'zip'])
    expect(order([zip, pdflib, pdfjs])).toEqual(['zip', 'pdflib', 'pdfjs'])
  })

  it('reports a tie as zero, so a stable sort leaves tied engines alone', () => {
    expect(byPreference(fake('zip', 20, 400_000), fake('pdfjs', 20, 400_000))).toBe(0)
  })
})

describe('enginesFor', () => {
  it('finds no candidate for a pair no registered engine claims', () => {
    expect(enginesFor({ from: 'rar', to: 'mp4', op: 'convert' }, desktop)).toEqual([])
    expect(enginesFor({ from: 'mp4', to: 'webm', op: 'convert' }, desktop)).toEqual([])
  })

  it('finds the engine that does claim the pair', () => {
    // Canvas and vips both write PNG from JPEG, and canvas is cheaper, so the
    // pair has two candidates in preference order rather than one.
    expect(enginesFor(jpgToPng, desktop).map((engine) => engine.id)).toEqual(['canvas', 'vips'])
    expect(
      enginesFor({ from: 'tiff', to: 'png', op: 'convert' }, desktop).map((engine) => engine.id),
    ).toEqual(['vips'])
  })

  it('returns them in preference order, best candidate first', () => {
    const candidates = enginesFor(jpgToPng, desktop)

    expect([...candidates].sort(byPreference)).toEqual(candidates)
  })

  it('returns a fresh array, so a caller sorting the result cannot touch ENGINES', () => {
    expect(enginesFor(jpgToPng, desktop)).not.toBe(ENGINES)
  })
})

describe('getEngine', () => {
  it('returns undefined for an id no engine has claimed yet', () => {
    expect(getEngine('ffmpeg')).toBeUndefined()
  })

  it('finds a registered engine by its id', () => {
    for (const engine of ENGINES) expect(getEngine(engine.id)).toBe(engine)
  })

  it('resolves an id an engine has claimed', () => {
    expect(getEngine('vips')?.priority).toBe(40)
  })

  it('constrains the id to the EngineId union', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    expect(getEngine('imagemagick')).toBeUndefined()
  })
})
