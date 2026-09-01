// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { resolveAudioBitrate } from '@/lib/engines/audio-options'
import type { FfmpegJob } from '@/lib/engines/ffmpeg-args'
import {
  FFMPEG_TARGETS,
  ffmpegArgs,
  ffmpegTargetFor,
  isFfmpegTarget,
  scaleFilter,
} from '@/lib/engines/ffmpeg-args'
import { bitrateForTargetSize, DEFAULT_CRF } from '@/lib/engines/video-compression'
import type { VideoOptions } from '@/lib/engines/video-options'
import type { FormatId } from '@/lib/router/types'

const job = (over: Partial<FfmpegJob> = {}): FfmpegJob => ({
  input: '/input.mp4',
  output: '/output.mp4',
  from: 'mp4',
  to: 'mp4',
  keepVideo: true,
  ...over,
})

/** The value ffmpeg would take for `flag`, or `undefined` if it is absent. */
const valueOf = (args: readonly string[], flag: string) => args[args.indexOf(flag) + 1]

describe('the target table', () => {
  it('names only encoders the vendored build actually has', () => {
    // ffmpeg 5.1.4 with libx264, libx265, libvpx, libmp3lame, libvorbis,
    // libopus, libtheora and libwebp, plus the native aac, flac and pcm. A job
    // that reaches this engine has been turned down by every faster one, so
    // naming an encoder that is not compiled in is failing outright.
    const compiled = new Set([
      'libx264',
      'libx265',
      'libvpx-vp9',
      'libmp3lame',
      'libvorbis',
      'libopus',
      'libtheora',
      'aac',
      'flac',
      'pcm_s16le',
    ])

    for (const target of Object.values(FFMPEG_TARGETS)) {
      if (target.video !== null) expect(compiled).toContain(target.video)
      expect(compiled).toContain(target.audio)
    }
  })

  it('gives every target a MIME type, so a download is named correctly', () => {
    for (const target of Object.values(FFMPEG_TARGETS)) {
      expect(target.mimeType).toMatch(/^(video|audio)\//)
    }
  })

  it('says which formats it writes when asked for one it does not', () => {
    expect(isFfmpegTarget('mp4')).toBe(true)
    expect(isFfmpegTarget('png' as FormatId)).toBe(false)
    expect(() => ffmpegTargetFor('png' as FormatId)).toThrow(/cannot write PNG/)
  })
})

describe('ffmpegArgs', () => {
  it('puts the input before the output options, which is the only order ffmpeg reads', () => {
    const args = ffmpegArgs(job())

    // An option after the output file applies to nothing at all.
    expect(args[0]).toBe('-i')
    expect(args[1]).toBe('/input.mp4')
    expect(args.at(-1)).toBe('/output.mp4')
  })

  it('writes H.264 and AAC into an MP4, with the index at the front', () => {
    const args = ffmpegArgs(job())

    expect(valueOf(args, '-c:v')).toBe('libx264')
    expect(valueOf(args, '-c:a')).toBe('aac')
    // Without `faststart` the file only plays once fully downloaded, which for a
    // converter's own output is the difference between previewing and not.
    expect(valueOf(args, '-movflags')).toBe('+faststart')
  })

  it('writes Opus into WebM rather than the Vorbis ffmpeg would choose', () => {
    const args = ffmpegArgs(job({ to: 'webm', output: '/output.webm' }))

    expect(valueOf(args, '-c:v')).toBe('libvpx-vp9')
    expect(valueOf(args, '-c:a')).toBe('libopus')
    // libvpx needs an explicit zero bitrate for `-crf` to mean constant quality.
    expect(valueOf(args, '-b:v')).toBe('0')
  })

  it('drops the picture explicitly for an audio target', () => {
    // ffmpeg will happily copy a video stream into an MP3 — as an attached
    // picture at best, as an unplayable file at worst.
    const args = ffmpegArgs(job({ to: 'mp3', output: '/output.mp3', keepVideo: false }))

    expect(args).toContain('-vn')
    expect(args).not.toContain('-c:v')
    expect(valueOf(args, '-c:a')).toBe('libmp3lame')
  })

  it('drops it for an extraction too, even out of a video container', () => {
    const args = ffmpegArgs(job({ from: 'mkv', to: 'wav', output: '/o.wav', keepVideo: false }))

    expect(args).toContain('-vn')
    expect(valueOf(args, '-c:a')).toBe('pcm_s16le')
  })

  it('leaves the bitrate off a lossless audio target, where it means nothing', () => {
    for (const to of ['wav', 'flac'] as const) {
      expect(ffmpegArgs(job({ to, output: `/o.${to}`, keepVideo: false }))).not.toContain('-b:a')
    }
  })

  it('encodes at constant quality unless the job named a bitrate', () => {
    // A target bitrate applied to a video that did not need one wastes space on
    // an easy scene and starves a hard one.
    expect(valueOf(ffmpegArgs(job()), '-crf')).toBe('23')

    const asked = ffmpegArgs(job({ video: { bitrate: 1_500_000 } }))
    expect(valueOf(asked, '-b:v')).toBe('1500000')
    expect(asked).not.toContain('-crf')
  })

  it('carries the requested frame rate', () => {
    expect(valueOf(ffmpegArgs(job({ video: { frameRate: 24 } })), '-r')).toBe('24')
    expect(ffmpegArgs(job())).not.toContain('-r')
  })

  it('derives the audio bitrate per channel, as every other engine does', () => {
    expect(valueOf(ffmpegArgs(job()), '-b:a')).toBe('192000')
    expect(valueOf(ffmpegArgs(job({ audio: { channels: 1 } })), '-b:a')).toBe('96000')
    expect(valueOf(ffmpegArgs(job({ audio: { bitrate: 128_000 } })), '-b:a')).toBe('128000')
  })
})

describe('scaleFilter', () => {
  it('is nothing at all when the job asked for no size', () => {
    expect(scaleFilter(undefined)).toBeNull()
    expect(scaleFilter({})).toBeNull()
    expect(scaleFilter({ width: 0 })).toBeNull()
  })

  it('keeps the aspect ratio and lands on an even number from one axis', () => {
    // `-2` rather than `-1`: both preserve the ratio, and only `-2` guarantees
    // the even dimension every codec here requires.
    expect(scaleFilter({ width: 1280 })).toBe('scale=1280:-2')
    expect(scaleFilter({ height: 720 })).toBe('scale=-2:720')
  })

  it('fits inside a two-axis box rather than stretching to it', () => {
    const filter = scaleFilter({ width: 1280, height: 720 })

    expect(filter).toContain('force_original_aspect_ratio=decrease')
    expect(filter).toContain('trunc(iw/2)*2')
  })
})

describe('ffmpegArgs — the four sizing methods', () => {
  const compress = (video: VideoOptions, to: FormatId = 'mp4', durationSeconds = 60) =>
    ffmpegArgs({
      input: '/input.mp4',
      output: `/output.${to}`,
      from: 'mp4',
      to,
      keepVideo: true,
      video,
      durationSeconds,
    })

  it('turns a target size into the bitrate that fills it', () => {
    const args = compress({ compression: { method: 'target-size', targetBytes: 8 * 1024 * 1024 } })

    const expected = bitrateForTargetSize(8 * 1024 * 1024, {
      durationSeconds: 60,
      audioBitrate: resolveAudioBitrate(undefined, 2),
    })

    expect(valueOf(args, '-b:v')).toBe(String(expected))
    // A fixed rate and a constant quality are opposite instructions.
    expect(args).not.toContain('-crf')
  })

  it('says so rather than overshooting when the running time was never found', () => {
    expect(() =>
      ffmpegArgs({
        input: '/input.mp4',
        output: '/output.mp4',
        from: 'mp4',
        to: 'mp4',
        keepVideo: true,
        video: { compression: { method: 'target-size', targetBytes: 8 * 1024 * 1024 } },
      }),
    ).toThrow(/how long/i)
  })

  it('passes a chosen quality straight through as a CRF', () => {
    const args = compress({ compression: { method: 'quality', crf: 18 } })

    expect(valueOf(args, '-crf')).toBe('18')
    expect(args).not.toContain('-b:v')
  })

  it('caps a constant-quality encode with maxrate and twice it as a buffer', () => {
    const args = compress({ compression: { method: 'max-bitrate', bitrate: 3_000_000 } })

    expect(valueOf(args, '-crf')).toBe(String(DEFAULT_CRF))
    expect(valueOf(args, '-maxrate')).toBe('3000000')
    // Smaller than the ceiling and the encoder cannot spend a burst on a hard
    // scene, which shows up as stutter rather than as a smaller file.
    expect(valueOf(args, '-bufsize')).toBe('6000000')
    expect(args).not.toContain('-b:v')
  })

  it('scales the picture for a resize and lets the rate follow the pixels', () => {
    const args = compress({ compression: { method: 'resize', width: 1280, height: 720 } })

    expect(valueOf(args, '-vf')).toContain('1280:720')
    expect(args).not.toContain('-b:v')
    expect(valueOf(args, '-crf')).toBe(String(DEFAULT_CRF))
  })

  it('lets a method override the bare fields the job was also carrying', () => {
    const args = compress({
      bitrate: 9_000_000,
      compression: { method: 'quality', crf: 20 },
    })

    expect(args).not.toContain('-b:v')
    expect(valueOf(args, '-crf')).toBe('20')
  })

  it('keeps the frame rate, which is not one of the methods', () => {
    const args = compress({ frameRate: 24, compression: { method: 'quality', crf: 20 } })

    expect(valueOf(args, '-r')).toBe('24')
  })

  describe('WebM, where libvpx reads the same flags differently', () => {
    it('adds the zero target rate that makes -crf mean constant quality', () => {
      const args = compress({ compression: { method: 'quality', crf: 30 } }, 'webm')

      expect(valueOf(args, '-crf')).toBe('30')
      expect(valueOf(args, '-b:v')).toBe('0')
    })

    it('does not overwrite a real bitrate with that zero', () => {
      // The bug this pair exists to stop: `-b:v 0` in the container's own extra
      // arguments came after `-b:v <rate>`, and ffmpeg takes the last one it is
      // given — so three of the four methods silently did nothing on WebM.
      const args = compress(
        { compression: { method: 'target-size', targetBytes: 8 * 1024 * 1024 } },
        'webm',
      )

      expect(args.filter((argument) => argument === '-b:v')).toHaveLength(1)
      expect(valueOf(args, '-b:v')).not.toBe('0')
    })
  })
})
