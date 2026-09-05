// @vitest-environment node

import { describe, expect, it, vi } from 'vitest'

import {
  chooseEncoderConfig,
  encodeBitrate,
  encoderCandidates,
  evenDimension,
  H264_CANDIDATES,
  planVideoEncode,
  sourceBitrate,
  sourceDurationSeconds,
  sourceFrameRate,
  targetSize,
} from '@/lib/engines/video-config'
import { bitrateForCrf, bitrateForTargetSize } from '@/lib/engines/video-compression'
import { BITS_PER_PIXEL_PER_SECOND, MIN_BITRATE, resolveBitrate } from '@/lib/engines/video-options'
import type { ConfigSupport, EncoderConfig } from '@/lib/engines/webcodecs-runtime'

const landscape = { width: 1920, height: 1080 }

const supports =
  (...accepted: string[]) =>
  async (config: EncoderConfig): Promise<ConfigSupport> => ({
    supported: accepted.includes(config.codec),
    config,
  })

describe('targetSize', () => {
  it('keeps the source size when the job asks for nothing', () => {
    expect(targetSize(landscape, undefined)).toEqual(landscape)
  })

  it('fits inside the requested box and keeps the proportions', () => {
    expect(targetSize(landscape, { width: 1280, height: 1280 })).toEqual({
      width: 1280,
      height: 720,
    })
  })

  it('derives the other axis from one', () => {
    expect(targetSize(landscape, { width: 640 })).toEqual({ width: 640, height: 360 })
    expect(targetSize(landscape, { height: 540 })).toEqual({ width: 960, height: 540 })
  })

  it('never enlarges, because upscaling spends bitrate inventing detail', () => {
    expect(targetSize({ width: 640, height: 480 }, { width: 1920 })).toEqual({
      width: 640,
      height: 480,
    })
  })

  it('rounds both axes to even numbers, which is all a 4:2:0 codec can represent', () => {
    expect(targetSize({ width: 1919, height: 1081 }, undefined)).toEqual({
      width: 1920,
      height: 1082,
    })
    expect(evenDimension(1)).toBe(2)
    expect(evenDimension(0)).toBe(2)
  })
})

describe('sourceFrameRate', () => {
  it('derives the rate from the samples, since an MP4 has no field for it', () => {
    // Ten samples of 3000 ticks at 90 kHz is 30 frames a second.
    const samples = Array.from({ length: 10 }, () => ({ duration: 3000 }))

    expect(sourceFrameRate(90_000, samples)).toBeCloseTo(30)
  })

  it('handles the broadcast rates that are not whole numbers', () => {
    const samples = Array.from({ length: 100 }, () => ({ duration: 1001 }))

    expect(sourceFrameRate(30_000, samples)).toBeCloseTo(29.97, 2)
  })

  it('says nothing rather than guessing when there is nothing to divide', () => {
    expect(sourceFrameRate(90_000, [])).toBeNull()
    expect(sourceFrameRate(0, [{ duration: 3000 }])).toBeNull()
    expect(sourceFrameRate(90_000, [{ duration: 0 }])).toBeNull()
  })
})

describe('encoderCandidates', () => {
  it('offers every profile with hardware preferred first, then without', () => {
    const candidates = encoderCandidates(landscape, 5_000_000, 30, undefined)

    expect(candidates.map((config) => `${config.codec} ${config.hardwareAcceleration}`)).toEqual([
      'avc1.640028 prefer-hardware',
      'avc1.640028 no-preference',
      'avc1.4d0028 prefer-hardware',
      'avc1.4d0028 no-preference',
      'avc1.420028 prefer-hardware',
      'avc1.420028 no-preference',
    ])
  })

  it('puts quality ahead of speed: High profile in software beats Main in hardware', () => {
    // Nobody is watching a file conversion in real time, so the better picture
    // is worth more than the faster encoder.
    const [, second, third] = encoderCandidates(landscape, 5_000_000, 30, undefined)

    expect(second.codec).toBe(H264_CANDIDATES[0])
    expect(third.codec).toBe(H264_CANDIDATES[1])
  })

  it('asks for software only when the job says not to use hardware', () => {
    const candidates = encoderCandidates(landscape, 5_000_000, 30, { hardware: false })

    expect(candidates.every((config) => config.hardwareAcceleration === 'no-preference')).toBe(true)
    expect(candidates).toHaveLength(H264_CANDIDATES.length)
  })

  it('asks for the length-prefixed bitstream a file stores, not the streaming one', () => {
    // `annexb` would put start codes in the samples and repeat the parameter
    // sets on every keyframe: right for a transport stream, wrong for an MP4.
    expect(encoderCandidates(landscape, 1, 30, undefined)[0].avc).toEqual({ format: 'avc' })
  })
})

describe('chooseEncoderConfig', () => {
  it('takes the first configuration the browser accepts', async () => {
    const chosen = await chooseEncoderConfig(
      encoderCandidates(landscape, 5_000_000, 30, undefined),
      supports('avc1.4d0028'),
    )

    expect(chosen.codec).toBe('avc1.4d0028')
    expect(chosen.hardwareAcceleration).toBe('prefer-hardware')
  })

  it('asks before configuring, every time, and never guesses', async () => {
    // The acceptance criterion, as a test: `configure()` reports a bad codec
    // asynchronously, several frames after the user has watched a bar move.
    const isSupported = vi.fn(supports('avc1.420028'))

    await chooseEncoderConfig(encoderCandidates(landscape, 1, 30, undefined), isSupported)

    expect(isSupported).toHaveBeenCalledTimes(5)
  })

  it('uses the configuration the browser hands back, not the one it was asked about', async () => {
    // `isConfigSupported` may correct a configuration — raise a level to cover
    // the resolution, say — and the corrected one is what it agreed to.
    const corrected = async (config: EncoderConfig): Promise<ConfigSupport> => ({
      supported: true,
      config: { ...config, codec: 'avc1.640032' },
    })

    const chosen = await chooseEncoderConfig(
      encoderCandidates(landscape, 1, 30, undefined),
      corrected,
    )

    expect(chosen.codec).toBe('avc1.640032')
  })

  it('treats a throw as a refusal and keeps going', async () => {
    let asked = 0
    const throwsThenAccepts = async (config: EncoderConfig): Promise<ConfigSupport> => {
      asked += 1
      if (asked === 1) throw new TypeError('Failed to read the "codec" property')

      return { supported: config.codec === H264_CANDIDATES[0], config }
    }

    const chosen = await chooseEncoderConfig(
      encoderCandidates(landscape, 1, 30, undefined),
      throwsThenAccepts,
    )

    expect(chosen.codec).toBe(H264_CANDIDATES[0])
  })

  it('names what it tried when nothing works, and suggests something to do', async () => {
    await expect(
      chooseEncoderConfig(encoderCandidates(landscape, 1, 30, undefined), supports()),
    ).rejects.toThrow(/avc1\.640028 \(prefer-hardware\)[\s\S]*smaller output size/)
  })
})

describe('planVideoEncode', () => {
  const source = {
    codec: 'avc1.64001f',
    timescale: 90_000,
    width: 1920,
    height: 1080,
  }
  const samples = Array.from({ length: 30 }, () => ({ duration: 3000 }))

  it('derives a bitrate from the output pixels when the job names none', async () => {
    const config = await planVideoEncode(source, samples, undefined, supports(H264_CANDIDATES[0]))

    expect(config.bitrate).toBe(Math.round(1920 * 1080 * 30 * BITS_PER_PIXEL_PER_SECOND))
    expect(config.framerate).toBeCloseTo(30)
  })

  it('sizes the bitrate to the resize, not to the source', async () => {
    // Half the width is a quarter of the pixels, and a quarter of the bitrate.
    const config = await planVideoEncode(
      source,
      samples,
      { width: 960 },
      supports(H264_CANDIDATES[0]),
    )

    expect(config.width).toBe(960)
    expect(config.height).toBe(540)
    expect(config.bitrate).toBe(Math.round(960 * 540 * 30 * BITS_PER_PIXEL_PER_SECOND))
  })

  it('takes the job’s own bitrate, floored at something watchable', async () => {
    const asked = await planVideoEncode(
      source,
      samples,
      { bitrate: 1_500_000 },
      supports(H264_CANDIDATES[0]),
    )
    const silly = await planVideoEncode(
      source,
      samples,
      { bitrate: 1 },
      supports(H264_CANDIDATES[0]),
    )

    expect(asked.bitrate).toBe(1_500_000)
    expect(silly.bitrate).toBe(MIN_BITRATE)
  })

  it('refuses a track that does not say how large its picture is', async () => {
    await expect(
      planVideoEncode({ codec: 'avc1', timescale: 90_000 }, samples, undefined, supports()),
    ).rejects.toThrow(/does not say how large/)
  })
})

describe('encodeBitrate — the same four methods, for an encoder with no CRF', () => {
  const size = { width: 1920, height: 1080 }
  const frameRate = 30

  it('honours a fixed rate as the rate', () => {
    expect(encodeBitrate({ bitrate: 4_000_000 }, undefined, size, frameRate)).toBe(4_000_000)
  })

  it('turns a CRF into the rate that scale defines it as', () => {
    expect(encodeBitrate({ crf: 17 }, undefined, size, frameRate)).toBe(
      bitrateForCrf(17, size.width, size.height, frameRate),
    )
  })

  it('takes the lower of the quality rate and a ceiling, which is the closest it can get', () => {
    // WebCodecs has no constrained-quality mode, so a maxrate can only be
    // honoured by encoding at or below it.
    const capped = encodeBitrate({ crf: 17, maxBitrate: 1_000_000 }, undefined, size, frameRate)

    expect(capped).toBe(1_000_000)
  })

  it('falls back to the size-derived default when no method was chosen', () => {
    expect(encodeBitrate({}, undefined, size, frameRate)).toBe(
      resolveBitrate(undefined, size.width, size.height, frameRate),
    )
  })
})

describe('sourceDurationSeconds', () => {
  it('adds the samples up and divides by the timescale', () => {
    const samples = Array.from({ length: 30 }, () => ({ duration: 1000 }))

    expect(sourceDurationSeconds(30_000, samples)).toBe(1)
  })

  it('answers zero for a track that says nothing', () => {
    expect(sourceDurationSeconds(0, [{ duration: 10 }])).toBe(0)
    expect(sourceDurationSeconds(600, [])).toBe(0)
  })
})

describe('planVideoEncode — the sizing methods end to end', () => {
  const format = {
    codec: 'avc1.64001f',
    timescale: 30_000,
    width: 1920,
    height: 1080,
  }
  const samples = Array.from({ length: 300 }, () => ({ duration: 1000 }))
  const accepts = async (config: EncoderConfig) => ({ supported: true, config })

  it('resizes the picture when the resize method names a size', () => {
    return expect(
      planVideoEncode(format, samples, { compression: { method: 'resize', width: 640 } }, accepts),
    ).resolves.toMatchObject({ width: 640, height: 360 })
  })

  it('turns a target size into a bitrate using the length it worked out itself', async () => {
    // 300 samples of 1000 ticks at 30 kHz is ten seconds.
    const config = await planVideoEncode(
      format,
      samples,
      { compression: { method: 'target-size', targetBytes: 5 * 1024 * 1024 } },
      accepts,
    )

    expect(config.bitrate).toBe(
      bitrateForTargetSize(5 * 1024 * 1024, { durationSeconds: 10, audioBitrate: 0 }),
    )
  })

  it('leaves room for a soundtrack the transcode is going to carry', async () => {
    // The video path copies the audio track through rather than dropping it, so
    // a size target that spent every bit on the picture would be beaten by the
    // sound that lands on top of it.
    const config = await planVideoEncode(
      format,
      samples,
      { compression: { method: 'target-size', targetBytes: 5 * 1024 * 1024 } },
      accepts,
      128_000,
    )

    expect(config.bitrate).toBe(
      bitrateForTargetSize(5 * 1024 * 1024, { durationSeconds: 10, audioBitrate: 128_000 }),
    )
  })

  it('turns a quality into the bitrate that quality is worth', async () => {
    const config = await planVideoEncode(
      format,
      samples,
      { compression: { method: 'quality', crf: 17 } },
      accepts,
    )

    expect(config.bitrate).toBe(bitrateForCrf(17, 1920, 1080, 30))
  })
})

describe('sourceBitrate', () => {
  const track = (count: number, bytes: number, duration: number) =>
    Array.from({ length: count }, () => ({ data: new Uint8Array(bytes), duration }))

  it('is the encoded bytes over the seconds they take, in bits', () => {
    // 100 packets of 1024 samples at 44.1 kHz is 2.32 seconds; 100 x 400 bytes
    // is 320 000 bits, so a shade under 138 kbps.
    expect(sourceBitrate(44_100, track(100, 400, 1024))).toBeCloseTo(
      320_000 / (102_400 / 44_100),
      0,
    )
  })

  it('answers zero for a track with no samples, rather than a division by nothing', () => {
    expect(sourceBitrate(44_100, [])).toBe(0)
  })

  it('answers zero for a timescale the file did not state', () => {
    expect(sourceBitrate(0, track(10, 400, 1024))).toBe(0)
  })

  it('answers zero when the samples claim no duration at all', () => {
    expect(sourceBitrate(44_100, track(10, 400, 0))).toBe(0)
  })
})
