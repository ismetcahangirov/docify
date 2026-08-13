import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  Capabilities,
  ConversionTask,
  EngineId,
  FormatId,
  Operation,
  RejectionCode,
  RouteRejection,
  RouteResult,
  RouteSuccess,
  Warning,
  WarningCode,
} from '@/lib/router/types'

/** A plain desktop device. Router tests build every other profile by spreading this. */
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

describe('ConversionTask', () => {
  it('pairs two formats with an operation', () => {
    const task: ConversionTask = { from: 'heic', to: 'jpg', op: 'convert' }

    expect(task).toEqual({ from: 'heic', to: 'jpg', op: 'convert' })
  })

  it('covers the image, document, video, audio and archive families', () => {
    const formats: FormatId[] = [
      'jpg',
      'png',
      'webp',
      'avif',
      'gif',
      'bmp',
      'tiff',
      'svg',
      'heic',
      'ico',
      'pdf',
      'mp4',
      'webm',
      'mov',
      'mkv',
      'avi',
      'mp3',
      'wav',
      'ogg',
      'm4a',
      'flac',
      'aac',
      'zip',
      'rar',
      '7z',
      'tar',
    ]

    expect(new Set(formats).size).toBe(formats.length)
  })

  it('covers every operation the tool pages offer', () => {
    const operations: Operation[] = [
      'convert',
      'compress',
      'resize',
      'crop',
      'rotate',
      'merge',
      'split',
      'extract',
      'organize',
      'protect',
      'unlock',
    ]

    expect(new Set(operations).size).toBe(operations.length)
  })

  it('rejects a format the app cannot handle', () => {
    // @ts-expect-error 'dwg' is not a FormatId
    const task: ConversionTask = { from: 'jpg', to: 'dwg', op: 'convert' }

    expect(task.to).toBe('dwg')
  })

  it('rejects an operation that is not in the union', () => {
    // @ts-expect-error 'transcode' is not an Operation
    const task: ConversionTask = { from: 'mp4', to: 'webm', op: 'transcode' }

    expect(task.op).toBe('transcode')
  })
})

describe('EngineId', () => {
  it('names all nine engines from the priority table', () => {
    const engines: EngineId[] = [
      'canvas',
      'webcodecs',
      'pdflib',
      'pdfjs',
      'zip',
      'heif',
      'vips',
      'libarchive',
      'ffmpeg',
    ]

    expect(new Set(engines).size).toBe(9)
  })

  it('rejects an engine that does not exist', () => {
    // @ts-expect-error 'imagemagick' is not an EngineId
    const engine: EngineId = 'imagemagick'

    expect(engine).toBe('imagemagick')
  })
})

describe('Capabilities', () => {
  it('is a plain data object, so router tests need no browser', () => {
    expect(desktop.platform).toBe('desktop')
    expect(desktop.browser).toBe('chromium')
  })

  it('models iOS Safari without WebCodecs or cross-origin isolation', () => {
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

    expect(ios.platform).toBe('ios')
  })

  it('constrains platform and browser to closed unions', () => {
    expectTypeOf<Capabilities['platform']>().toEqualTypeOf<'ios' | 'android' | 'desktop'>()
    expectTypeOf<Capabilities['browser']>().toEqualTypeOf<
      'safari' | 'chromium' | 'firefox' | 'unknown'
    >()
  })

  it('rejects an unknown platform', () => {
    // @ts-expect-error 'windows-phone' is not a platform
    const caps: Capabilities = { ...desktop, platform: 'windows-phone' }

    expect(caps.platform).toBe('windows-phone')
  })

  it('requires every probed flag — a partial probe must not typecheck', () => {
    // @ts-expect-error every capability field is mandatory
    const caps: Capabilities = { platform: 'desktop', browser: 'chromium' }

    expect(caps.platform).toBe('desktop')
  })
})

describe('Warning', () => {
  it('carries a code and a message', () => {
    const warning: Warning = {
      code: 'SLOW_PATH',
      message: 'No hardware acceleration available, so this will take longer.',
    }

    expect(warning.code).toBe('SLOW_PATH')
  })

  it('exposes the warning codes as a reusable union', () => {
    expectTypeOf<WarningCode>().toEqualTypeOf<
      'SLOW_PATH' | 'QUALITY_LOSS' | 'LARGE_DOWNLOAD' | 'NO_ISOLATION'
    >()
    expectTypeOf<Warning['code']>().toEqualTypeOf<WarningCode>()
  })

  it('rejects an invented warning code', () => {
    // @ts-expect-error 'MAYBE_SLOW' is not a WarningCode
    const warning: Warning = { code: 'MAYBE_SLOW', message: 'Hmm.' }

    expect(warning.code).toBe('MAYBE_SLOW')
  })
})

describe('RejectionCode', () => {
  it('has exactly the five codes the router can return', () => {
    const codes: RejectionCode[] = [
      'FILE_TOO_LARGE',
      'UNSUPPORTED_PAIR',
      'DEVICE_TOO_WEAK',
      'CODEC_UNAVAILABLE',
      'EMPTY_INPUT',
    ]

    expect(new Set(codes).size).toBe(5)
  })

  it('rejects a code outside the union', () => {
    // @ts-expect-error 'UNKNOWN_ERROR' is not a RejectionCode
    const code: RejectionCode = 'UNKNOWN_ERROR'

    expect(code).toBe('UNKNOWN_ERROR')
  })
})

describe('RouteResult', () => {
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

  it('is the union of the success and rejection branches', () => {
    expectTypeOf<RouteResult>().toEqualTypeOf<RouteSuccess | RouteRejection>()
  })

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

  // Invariant 2.5 — a rejection always explains itself.
  it('does not typecheck without a suggestion', () => {
    const incomplete: RouteRejection = {
      ok: false,
      code: 'FILE_TOO_LARGE',
      message: 'This file is 4.0 GB.',
      // @ts-expect-error suggestion is mandatory on every rejection
      suggestion: undefined,
    }

    expect(incomplete.suggestion).toBeUndefined()
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

  it('types both explanation fields as required strings', () => {
    expectTypeOf<RouteRejection['message']>().toEqualTypeOf<string>()
    expectTypeOf<RouteRejection['suggestion']>().toEqualTypeOf<string>()
    expectTypeOf<RouteRejection>().toHaveProperty('message')
    expectTypeOf<RouteRejection>().toHaveProperty('suggestion')
  })

  it('carries warnings on the success branch', () => {
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
})

describe('module purity', () => {
  it('exports types only, so importing it costs nothing at runtime', async () => {
    const namespace: Record<string, unknown> = await import('@/lib/router/types')

    expect(Object.keys(namespace).filter((key) => key !== 'default')).toEqual([])
  })
})
