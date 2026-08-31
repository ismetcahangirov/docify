import { describe, expect, expectTypeOf, it } from 'vitest'

import type {
  Browser,
  Capabilities,
  ConversionTask,
  EngineId,
  FormatId,
  Operation,
  Platform,
  RejectionCode,
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

  // Pinned in both directions: adding a format silently is as much a regression
  // as removing one, because the pairs registry and the SEO pages enumerate this.
  it('is exactly the image, document, video, audio and archive formats', () => {
    expectTypeOf<FormatId>().toEqualTypeOf<
      | 'jpg'
      | 'png'
      | 'webp'
      | 'avif'
      | 'gif'
      | 'bmp'
      | 'tiff'
      | 'svg'
      | 'heic'
      | 'ico'
      | 'pdf'
      | 'txt'
      | 'mp4'
      | 'webm'
      | 'mov'
      | 'mkv'
      | 'avi'
      | 'mp3'
      | 'wav'
      | 'ogg'
      | 'm4a'
      | 'flac'
      | 'aac'
      | 'zip'
      | 'rar'
      | '7z'
      | 'tar'
    >()
  })

  it('is exactly the operations the tool pages offer', () => {
    expectTypeOf<Operation>().toEqualTypeOf<
      | 'convert'
      | 'compress'
      | 'resize'
      | 'crop'
      | 'rotate'
      | 'flip'
      | 'merge'
      | 'split'
      | 'extract'
      | 'organize'
      | 'protect'
      | 'unlock'
    >()
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
  it('is exactly the nine engines in the priority table', () => {
    expectTypeOf<EngineId>().toEqualTypeOf<
      | 'canvas'
      | 'vips'
      | 'heif'
      | 'pdflib'
      | 'pdfjs'
      | 'webcodecs'
      | 'ffmpeg'
      | 'zip'
      | 'libarchive'
    >()
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
    expectTypeOf<Platform>().toEqualTypeOf<'ios' | 'android' | 'desktop'>()
    expectTypeOf<Browser>().toEqualTypeOf<'safari' | 'chromium' | 'firefox' | 'unknown'>()
    // The plan indexes these off Capabilities; both spellings must stay valid.
    expectTypeOf<Capabilities['platform']>().toEqualTypeOf<Platform>()
    expectTypeOf<Capabilities['browser']>().toEqualTypeOf<Browser>()
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

  it('is exactly the four warning codes the router can raise', () => {
    expectTypeOf<WarningCode>().toEqualTypeOf<
      'SLOW_PATH' | 'QUALITY_LOSS' | 'LARGE_DOWNLOAD' | 'NO_ISOLATION' | 'LAYOUT_LOSS'
    >()
  })

  it('rejects an invented warning code', () => {
    // @ts-expect-error 'MAYBE_SLOW' is not a WarningCode
    const warning: Warning = { code: 'MAYBE_SLOW', message: 'Hmm.' }

    expect(warning.code).toBe('MAYBE_SLOW')
  })
})

describe('RejectionCode', () => {
  it('is exactly the five codes the router can return', () => {
    expectTypeOf<RejectionCode>().toEqualTypeOf<
      | 'FILE_TOO_LARGE'
      | 'UNSUPPORTED_PAIR'
      | 'DEVICE_TOO_WEAK'
      | 'CODEC_UNAVAILABLE'
      | 'EMPTY_INPUT'
    >()
  })

  it('rejects a code outside the union', () => {
    // @ts-expect-error 'UNKNOWN_ERROR' is not a RejectionCode
    const code: RejectionCode = 'UNKNOWN_ERROR'

    expect(code).toBe('UNKNOWN_ERROR')
  })
})
