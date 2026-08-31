// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { descriptor, WEBCODECS_LOAD_COST } from '@/lib/engines/webcodecs'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

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

describe('the webcodecs descriptor', () => {
  it('sits ahead of every other video engine and behind Canvas', () => {
    expect(descriptor.id).toBe('webcodecs')
    expect(descriptor.priority).toBe(15)
    expect(descriptor.label).toMatch(/hardware/i)
  })

  it('quotes only what it downloads, which is mp4box and not a codec', () => {
    // The codecs are the platform's and cost nothing, which is the whole reason
    // this engine outranks ffmpeg by 75 places.
    expect(descriptor.loadCost).toBe(WEBCODECS_LOAD_COST)
    expect(descriptor.loadCost).toBeLessThan(1_000_000)
  })

  it('claims the ISO containers it can read, into the one it can write', () => {
    expect(descriptor.supports(task('mp4', 'mp4'), desktop)).toBe(true)
    expect(descriptor.supports(task('mov', 'mp4'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'mp4', 'compress'), desktop)).toBe(true)
  })

  it('leaves the containers mp4box cannot read to ffmpeg', () => {
    // WebM, MKV and AVI are not the ISO base media file format. Claiming them
    // would route a job to an engine that fails after the download.
    expect(descriptor.supports(task('webm', 'mp4'), desktop)).toBe(false)
    expect(descriptor.supports(task('mkv', 'mp4'), desktop)).toBe(false)
    expect(descriptor.supports(task('avi', 'mp4'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'webm'), desktop)).toBe(false)
  })

  it('claims the audio pairs the browser can encode, gated on the audio codecs', () => {
    expect(descriptor.supports(task('m4a', 'm4a'), desktop)).toBe(true)
    expect(descriptor.supports(task('mp4', 'ogg'), desktop)).toBe(true)
    expect(descriptor.supports(task('m4a', 'ogg', 'compress'), desktop)).toBe(true)

    // A browser can genuinely have one family of codecs and not the other,
    // which is why `Capabilities` probes them apart and this gates on the one
    // the job actually needs.
    expect(descriptor.supports(task('m4a', 'ogg'), { ...desktop, webCodecsAudio: false })).toBe(
      false,
    )
    expect(descriptor.supports(task('m4a', 'ogg'), { ...desktop, webCodecsVideo: false })).toBe(
      true,
    )
  })

  it('leaves MP3 to ffmpeg, because no browser has an encoder for it', () => {
    // `AudioEncoder` decodes MP3 and writes nothing; the alternative is an LGPL
    // encoder, which is the repository owner's decision rather than an engine's.
    expect(descriptor.supports(task('m4a', 'mp3'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'wav'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'flac'), desktop)).toBe(false)
  })

  it('never converts an audio-only container as video', () => {
    // An `.m4a` is the same box structure as an `.mp4` and, by convention, has
    // no picture in it: converting one "to MP4" would produce a blank screen.
    expect(descriptor.supports(task('m4a', 'mp4'), desktop)).toBe(false)
  })

  it('claims no operation it does not implement', () => {
    expect(descriptor.supports(task('mp4', 'mp4', 'extract'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'mp4', 'merge'), desktop)).toBe(false)
    expect(descriptor.supports(task('mp4', 'mp3', 'extract'), desktop)).toBe(false)
  })

  it('stands down on a browser without the video codecs', () => {
    expect(descriptor.supports(task('mp4', 'mp4'), { ...desktop, webCodecsVideo: false })).toBe(
      false,
    )
  })

  it('decides from the task and the capabilities alone', () => {
    const before = task('mov', 'mp4')
    const caps = { ...desktop }

    descriptor.supports(before, caps)

    expect(before).toEqual(task('mov', 'mp4'))
    expect(caps).toEqual(desktop)
  })
})
