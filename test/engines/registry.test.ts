import { describe, expect, it } from 'vitest'

import { ENGINES, enginesFor, getEngine } from '@/lib/engines/registry'
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

describe('ENGINES', () => {
  it('is empty until the first engine lands, so the router rejects every pair', () => {
    expect(ENGINES).toEqual([])
  })

  it('cannot be mutated by a consumer', () => {
    expect(Object.isFrozen(ENGINES)).toBe(true)
  })
})

describe('enginesFor', () => {
  it('returns no candidates for any task while the registry is empty', () => {
    expect(enginesFor(jpgToPng, desktop)).toEqual([])
    expect(enginesFor({ from: 'mp4', to: 'webm', op: 'convert' }, desktop)).toEqual([])
  })

  it('keeps only the engines that support the task', () => {
    const yes = { ...fake('canvas', 10, 0), supports: () => true }
    const no = { ...fake('vips', 40, 5_500_000), supports: () => false }

    expect(enginesFor(jpgToPng, desktop, [no, yes])).toEqual([yes])
  })

  it('decides support from the task and the capabilities alone', () => {
    const seen: Array<[ConversionTask, Capabilities]> = []
    const spy: EngineDescriptor = {
      ...fake('canvas', 10, 0),
      supports: (task, caps) => {
        seen.push([task, caps])
        return false
      },
    }

    enginesFor(jpgToPng, desktop, [spy])

    expect(seen).toEqual([[jpgToPng, desktop]])
  })

  it('orders candidates by priority, lowest first', () => {
    const ffmpeg = fake('ffmpeg', 90, 32_000_000)
    const canvas = fake('canvas', 10, 0)
    const vips = fake('vips', 40, 5_500_000)

    expect(enginesFor(jpgToPng, desktop, [ffmpeg, vips, canvas]).map((e) => e.id)).toEqual([
      'canvas',
      'vips',
      'ffmpeg',
    ])
  })

  it('breaks a priority tie with the cheaper download', () => {
    const heavy = fake('vips', 40, 5_500_000)
    const light = fake('heif', 40, 900_000)

    expect(enginesFor(jpgToPng, desktop, [heavy, light]).map((e) => e.id)).toEqual(['heif', 'vips'])
  })

  it('keeps registration order when priority and load cost are both equal', () => {
    const first = fake('pdflib', 20, 400_000)
    const second = fake('pdfjs', 20, 400_000)

    expect(enginesFor(jpgToPng, desktop, [first, second]).map((e) => e.id)).toEqual([
      'pdflib',
      'pdfjs',
    ])
  })

  it('does not reorder the registry it was given', () => {
    const ffmpeg = fake('ffmpeg', 90, 32_000_000)
    const canvas = fake('canvas', 10, 0)
    const registry = [ffmpeg, canvas]

    enginesFor(jpgToPng, desktop, registry)

    expect(registry.map((e) => e.id)).toEqual(['ffmpeg', 'canvas'])
  })
})

describe('getEngine', () => {
  it('returns undefined for an id that is not registered', () => {
    expect(getEngine('ffmpeg')).toBeUndefined()
  })

  it('returns the descriptor when the id is registered', () => {
    const canvas = fake('canvas', 10, 0)

    expect(getEngine('canvas', [canvas])).toBe(canvas)
  })

  it('constrains the id to the EngineId union', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    expect(getEngine('imagemagick')).toBeUndefined()
  })
})
