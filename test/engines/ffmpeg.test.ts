// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { descriptor } from '@/lib/engines/ffmpeg'
import {
  FFMPEG_ASSET_PATH,
  FFMPEG_LOAD_COST,
  FFMPEG_MODULE_FILE,
  FFMPEG_WASM_FILE,
  ffmpegModuleUrl,
} from '@/lib/engines/ffmpeg-runtime'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'
import { ffmpegAssetBytes, FFMPEG_VENDORED_FILES } from '../../scripts/vendor-ffmpeg/vendor.mjs'

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

const task = (from: FormatId, to: FormatId, op: Operation = 'convert'): ConversionTask => ({
  from,
  to,
  op,
})

describe('the ffmpeg descriptor', () => {
  it('sits last in the priority table, by a wide margin', () => {
    // Nothing another engine can take should ever land here: it downloads 30 MB
    // and decodes in software what WebCodecs decodes on a GPU.
    expect(descriptor.id).toBe('ffmpeg')
    expect(descriptor.priority).toBe(90)
  })

  it('quotes the download the router promises the user', () => {
    const measured = FFMPEG_VENDORED_FILES.reduce(
      (total: number, file: string) => total + ffmpegAssetBytes(file),
      0,
    )

    // Re-measured from the installed package, so an upgrade that changes the
    // size fails here rather than quietly making the router's `LARGE_DOWNLOAD`
    // warning wrong.
    expect(descriptor.loadCost).toBe(FFMPEG_LOAD_COST)
    expect(descriptor.loadCost).toBe(measured)
  })

  it('takes the containers no faster engine can read', () => {
    expect(descriptor.supports(task('webm', 'mp4'), desktop)).toBe(true)
    expect(descriptor.supports(task('mkv', 'mp4'), desktop)).toBe(true)
    expect(descriptor.supports(task('avi', 'webm'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'webm'), desktop)).toBe(true)
  })

  it('takes the audio formats no browser encoder can write', () => {
    expect(descriptor.supports(task('m4a', 'mp3'), desktop)).toBe(true)
    expect(descriptor.supports(task('flac', 'wav'), desktop)).toBe(true)
    expect(descriptor.supports(task('wav', 'flac'), desktop)).toBe(true)
  })

  it('claims extraction only where there is a picture to drop', () => {
    expect(descriptor.supports(task('mp4', 'mp3', 'extract'), desktop)).toBe(true)
    // Pulling sound out of something with no picture is a conversion, and
    // claiming it here would give one job two names.
    expect(descriptor.supports(task('mp3', 'wav', 'extract'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'webm', 'extract'), desktop)).toBe(false)
  })

  it('claims nothing outside media', () => {
    expect(descriptor.supports(task('jpg', 'png'), desktop)).toBe(false)
    expect(descriptor.supports(task('pdf', 'jpg'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'png'), desktop)).toBe(false)
    expect(descriptor.supports(task('zip', 'mp4'), desktop)).toBe(false)
  })

  it('claims no operation it does not implement', () => {
    expect(descriptor.supports(task('mp4', 'mp4', 'merge'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'mp4', 'split'), desktop)).toBe(false)
  })

  it('needs no capability at all, which is the whole point of a fallback', () => {
    // A five-year-old phone with no WebCodecs, no isolation and no SIMD still
    // converts video here.
    const bare: Capabilities = {
      ...desktop,
      crossOriginIsolated: false,
      wasmSimd: false,
      webCodecsVideo: false,
      webCodecsAudio: false,
      offscreenCanvas: false,
      createImageBitmap: false,
    }

    expect(descriptor.supports(task('mkv', 'mp4'), bare)).toBe(true)
  })
})

describe('ffmpegModuleUrl', () => {
  it('resolves against this origin and nowhere else', () => {
    expect(ffmpegModuleUrl('https://docify.test')).toBe(
      `https://docify.test${FFMPEG_ASSET_PATH}${FFMPEG_MODULE_FILE}`,
    )
  })

  it('says which two bases cannot resolve it, rather than "Invalid URL"', () => {
    // Server rendering has no location, and a sandboxed iframe, a data:
    // document and a file:// page all report an opaque origin.
    expect(() => ffmpegModuleUrl('')).toThrow(/served from this origin/)
    expect(() => ffmpegModuleUrl('null')).toThrow(/opaque origin/)
  })

  it('names the same two files the vendor script copies', () => {
    expect([...FFMPEG_VENDORED_FILES].sort()).toEqual([FFMPEG_MODULE_FILE, FFMPEG_WASM_FILE].sort())
  })
})

describe('the ffmpeg descriptor, on GIF', () => {
  it('claims a video turning into an animation', () => {
    for (const from of ['mp4', 'webm', 'mov', 'mkv', 'avi'] as const) {
      expect(descriptor.supports(task(from, 'gif'), desktop)).toBe(true)
    }
  })

  it('refuses to make one out of a soundtrack', () => {
    // A GIF holds nothing but a picture, so a source with none has nothing to
    // give it. Claiming the pair would spend a 31 MB download on a job that
    // fails at the last step.
    for (const from of ['mp3', 'wav', 'ogg', 'flac', 'm4a', 'aac'] as const) {
      expect(descriptor.supports(task(from, 'gif'), desktop)).toBe(false)
    }
  })

  it('does not treat a GIF as something to extract sound from', () => {
    expect(descriptor.supports(task('mp4', 'gif', 'extract'), desktop)).toBe(false)
  })

  it('still claims the audio targets it always did', () => {
    expect(descriptor.supports(task('mp3', 'wav'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'mp3', 'extract'), desktop)).toBe(true)
  })
})
