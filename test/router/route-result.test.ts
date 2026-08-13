import { describe, expect, expectTypeOf, it } from 'vitest'

import type { RouteRejection, RouteResult, RouteSuccess, Warning } from '@/lib/router/types'

const success: RouteSuccess = {
  ok: true,
  engine: 'webcodecs',
  reason: 'Hardware-accelerated (WebCodecs)',
  loadCost: 120_000,
  warnings: [],
}

const rejection: RouteRejection = {
  ok: false,
  code: 'DEVICE_TOO_WEAK',
  message: 'This file is 200 MB. The safe limit on this device is 20 MB.',
  suggestion: 'Open this on a desktop — mobile browsers have a much lower memory ceiling.',
}

describe('RouteResult narrowing', () => {
  it('narrows to the engine choice when ok is true', () => {
    const result: RouteResult = success

    if (!result.ok) throw new Error('expected a successful route')

    expectTypeOf(result).toEqualTypeOf<RouteSuccess>()
    expect(result.engine).toBe('webcodecs')
    expect(result.loadCost).toBe(120_000)
    expect(result.warnings).toEqual([])
  })

  it('narrows to the rejection when ok is false', () => {
    const result: RouteResult = rejection

    if (result.ok) throw new Error('expected a rejection')

    expectTypeOf(result).toEqualTypeOf<RouteRejection>()
    expect(result.code).toBe('DEVICE_TOO_WEAK')
  })

  it('never exposes an engine on the rejection branch', () => {
    const result: RouteResult = rejection

    if (result.ok) throw new Error('expected a rejection')

    // @ts-expect-error a rejection carries no engine
    expect(result.engine).toBeUndefined()
  })

  it('never exposes a rejection code on the success branch', () => {
    const result: RouteResult = success

    if (!result.ok) throw new Error('expected a successful route')

    // @ts-expect-error a successful route carries no rejection code
    expect(result.code).toBeUndefined()
  })
})

// Invariant 2.5 — a rejection always explains itself. Each case below omits a
// field outright, so the directive is consumed by the missing-property error and
// nothing else: weakening either field to optional makes these tests fail CI.
describe('RouteRejection explains itself', () => {
  it('does not typecheck without a suggestion', () => {
    // @ts-expect-error suggestion is mandatory on every rejection
    const incomplete: RouteRejection = {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'This file is 4.0 GB. The safe limit on this device is 267 MB.',
    }

    expect(incomplete.code).toBe('FILE_TOO_LARGE')
  })

  it('does not typecheck without a message', () => {
    // @ts-expect-error message is mandatory on every rejection
    const incomplete: RouteRejection = {
      ok: false,
      code: 'UNSUPPORTED_PAIR',
      suggestion: 'Try again in a recent version of Chrome or Edge.',
    }

    expect(incomplete.code).toBe('UNSUPPORTED_PAIR')
  })

  it('does not accept undefined in place of an explanation', () => {
    const blank: RouteRejection = {
      ok: false,
      code: 'EMPTY_INPUT',
      message: 'This file is empty.',
      // @ts-expect-error suggestion must be a real string, not undefined
      suggestion: undefined,
    }

    expect(blank.suggestion).toBeUndefined()
  })

  it('types both explanation fields as required strings', () => {
    expectTypeOf<RouteRejection['message']>().toEqualTypeOf<string>()
    expectTypeOf<RouteRejection['suggestion']>().toEqualTypeOf<string>()
  })
})

describe('RouteSuccess', () => {
  it('carries the warnings the UI has to surface', () => {
    const slow: RouteSuccess = {
      ok: true,
      engine: 'ffmpeg',
      reason: 'Universal fallback',
      loadCost: 32_000_000,
      warnings: [
        { code: 'SLOW_PATH', message: 'No hardware acceleration available.' },
        { code: 'LARGE_DOWNLOAD', message: 'Loading the engine (32 MB) — one time only.' },
      ],
    }

    expectTypeOf<RouteSuccess['warnings']>().toEqualTypeOf<Warning[]>()
    expect(slow.warnings.map((w) => w.code)).toEqual(['SLOW_PATH', 'LARGE_DOWNLOAD'])
  })

  it('requires a reason and a load cost, so the UI never has to guess', () => {
    // @ts-expect-error reason and loadCost are mandatory
    const bare: RouteSuccess = { ok: true, engine: 'canvas', warnings: [] }

    expect(bare.engine).toBe('canvas')
  })
})

describe('module purity', () => {
  it('exports types only, so importing it costs nothing at runtime', async () => {
    const namespace: Record<string, unknown> = await import('@/lib/router/types')

    expect(Object.keys(namespace).filter((key) => key !== 'default')).toEqual([])
  })
})
