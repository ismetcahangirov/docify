// @vitest-environment node
//
// The descriptor half of an engine is a handful of numbers and a synchronous
// predicate, and it has to stay that way: `registry.ts` imports it statically,
// so anything it touches ships in the initial bundle. Under `node` there is no
// DOM to touch by accident.

import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import {
  CANVAS_READABLE,
  CANVAS_WRITABLE,
  descriptor,
  preservesMetadata,
} from '@/lib/engines/canvas'
import { ENGINES, getEngine } from '@/lib/engines/registry'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

import { staticGraphOf } from '../support/import-graph'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const task = (from: FormatId, to: FormatId, op: Operation = 'convert'): ConversionTask => ({
  from,
  to,
  op,
})

/**
 * Everything off. `supports` must not consult `Capabilities` at all: the two
 * APIs the engine needs are structural, and `route()` gates on them itself so
 * that a browser without them gets `CODEC_UNAVAILABLE` naming the missing half
 * rather than a flat `UNSUPPORTED_PAIR`.
 */
const bareDevice: Capabilities = {
  crossOriginIsolated: false,
  wasmSimd: false,
  deviceMemoryGb: 1,
  cores: 1,
  webCodecsVideo: false,
  webCodecsAudio: false,
  offscreenCanvas: false,
  createImageBitmap: false,
  platform: 'ios',
  browser: 'safari',
}

describe('the canvas descriptor', () => {
  it('is the zero-download engine at the head of the priority table', () => {
    expect(descriptor.id).toBe('canvas')
    expect(descriptor.loadCost).toBe(0)
    expect(descriptor.priority).toBe(10)
    expect(descriptor.label.length).toBeGreaterThan(0)
  })

  it('covers the four formats the browser can both read and write', () => {
    expect([...CANVAS_WRITABLE].sort()).toEqual(['bmp', 'jpg', 'png', 'webp'])
  })

  it('reads those four and SVG, which it can render but never write', () => {
    expect([...CANVAS_READABLE].sort()).toEqual(['bmp', 'jpg', 'png', 'svg', 'webp'])
  })

  it('supports every pair among those four, in both directions', () => {
    for (const from of CANVAS_WRITABLE) {
      for (const to of CANVAS_WRITABLE) {
        expect(descriptor.supports(task(from, to), bareDevice)).toBe(true)
      }
    }
  })

  it('rasterises SVG into every format it writes, and never back into one', () => {
    for (const to of CANVAS_WRITABLE) {
      expect(descriptor.supports(task('svg', to), bareDevice)).toBe(true)
      expect(descriptor.supports(task(to, 'svg'), bareDevice)).toBe(false)
    }
  })

  it('claims no format it cannot decode or encode natively', () => {
    expect(descriptor.supports(task('heic', 'jpg'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('jpg', 'avif'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('tiff', 'png'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('png', 'pdf'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('mp4', 'webm'), bareDevice)).toBe(false)
  })

  it('claims only the plain format swap, not the operations it has no options for', () => {
    // `EngineInput` carries no quality, size or angle yet, so an engine that
    // accepted `resize` would silently return the original dimensions.
    expect(descriptor.supports(task('jpg', 'png', 'resize'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('jpg', 'jpg', 'compress'), bareDevice)).toBe(false)
    expect(descriptor.supports(task('png', 'png', 'rotate'), bareDevice)).toBe(false)
  })

  it('reads nothing from the device, leaving the capability gate to the router', () => {
    const everythingOn: Capabilities = {
      ...bareDevice,
      offscreenCanvas: true,
      createImageBitmap: true,
      platform: 'desktop',
    }

    expect(descriptor.supports(task('jpg', 'png'), everythingOn)).toBe(
      descriptor.supports(task('jpg', 'png'), bareDevice),
    )
  })
})

describe('the canvas descriptor, as the registry sees it', () => {
  it('is registered exactly once', () => {
    expect(ENGINES.filter((engine) => engine.id === 'canvas')).toEqual([descriptor])
  })

  it('is reachable by id', () => {
    expect(getEngine('canvas')).toBe(descriptor)
  })
})

describe('the canvas engine module graph', () => {
  const engineGraph = staticGraphOf('lib/engines/canvas.ts', repoRoot)
  const registryGraph = staticGraphOf('lib/engines/registry.ts', repoRoot)

  it('costs no npm dependency at all', () => {
    expect(engineGraph.packages).toEqual([])
  })

  it('does not statically reach its own runner, which the worker imports lazily', () => {
    // CLAUDE.md §2.3. `registry.ts` imports this module statically, so a static
    // import of the runner here would put the encoder in every page's bundle.
    expect(engineGraph.files).not.toContain('lib/engines/canvas-runner.ts')
    expect(engineGraph.files).not.toContain('lib/engines/bmp.ts')
  })

  it('keeps the runner out of the registry graph, and therefore out of the router bundle', () => {
    expect(registryGraph.files).not.toContain('lib/engines/canvas-runner.ts')
    expect(registryGraph.files).not.toContain('lib/engines/bmp.ts')
    expect(registryGraph.packages).toEqual([])
  })
})

describe('preservesMetadata', () => {
  it('is true for the one pair a canvas can put metadata back into', () => {
    expect(preservesMetadata({ from: 'jpg', to: 'jpg', op: 'convert' })).toBe(true)
  })

  it('is false everywhere else, including out of a JPEG', () => {
    // A browser's PNG and WebP encoders expose no hook for a metadata chunk, and
    // BMP has nowhere to put one at all. Saying so is what lets a caller warn
    // before the conversion instead of the user finding out afterwards.
    expect(preservesMetadata({ from: 'jpg', to: 'png', op: 'convert' })).toBe(false)
    expect(preservesMetadata({ from: 'jpg', to: 'webp', op: 'convert' })).toBe(false)
    expect(preservesMetadata({ from: 'jpg', to: 'bmp', op: 'convert' })).toBe(false)
    expect(preservesMetadata({ from: 'png', to: 'jpg', op: 'convert' })).toBe(false)
  })
})
