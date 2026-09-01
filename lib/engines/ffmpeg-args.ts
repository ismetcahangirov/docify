/**
 * Building the ffmpeg command line for one job.
 *
 * Pure, and separate from the module that runs it, because the command line is
 * where a media converter is right or wrong: a missing `-vn` puts a video track
 * in an MP3, a missing `-movflags` writes an MP4 whose index is at the end and
 * which no browser can stream, and `-c:v copy` into a container that cannot hold
 * the codec fails after the whole file has been read. All of that is provable
 * against an array of strings, with no 31 MB binary in the room.
 *
 * ## Why a table and not a switch
 *
 * Every target format is one entry saying which codecs it takes. ffmpeg would
 * pick defaults on its own, and its defaults are not always what a browser can
 * play — it will happily write Vorbis into a WebM that Safari then refuses. The
 * table is short enough to read and long enough to be the whole policy.
 *
 * ## What the vendored build has
 *
 * ffmpeg 5.1.4 with libx264, libx265, libvpx, libmp3lame, libvorbis, libopus,
 * libtheora and libwebp — see `./ffmpeg-runtime`. Nothing here may name an
 * encoder outside that list; a job that reaches ffmpeg has already been refused
 * by every faster engine, so failing at the last one is failing outright.
 */

import type { FormatId } from '@/lib/router/types'

import type { AudioOptions } from './audio-options'
import { resolveAudioBitrate } from './audio-options'
import type { ResolvedVideoEncode } from './video-compression'
import { DEFAULT_CRF, resolveVideoEncode } from './video-compression'
import type { VideoOptions } from './video-options'

/** How one output format is produced. */
export interface FfmpegTarget {
  /** The video encoder, or `null` for an audio-only container. */
  video: string | null
  audio: string
  /** Extra arguments the container needs, after the codecs. */
  extra?: readonly string[]
  /**
   * Arguments the video encoder needs in *constant-quality* mode, and only then.
   *
   * libvpx is the reason this is separate from {@link extra}: it reads `-crf` as
   * an upper bound unless `-b:v 0` is also given, so a WebM asked for constant
   * quality needs the pair. Emitting `-b:v 0` unconditionally, which is what
   * carrying it in `extra` amounts to, silently overrides the `-b:v` a target
   * size or a chosen bitrate just set: ffmpeg takes the last one it is given.
   * That made three of the four sizing methods do nothing on WebM.
   */
  constantQuality?: readonly string[]
  mimeType: string
}

/** The preset that trades a little size for a lot of time, which is the right way round here. */
const DEFAULT_PRESET = 'veryfast'

/**
 * Every format this engine writes.
 *
 * `faststart` moves an MP4's index to the front. Without it the file only plays
 * once it has been fully downloaded, which for a converter's own output is the
 * difference between a file that previews and one that does not.
 */
export const FFMPEG_TARGETS: Readonly<Partial<Record<FormatId, FfmpegTarget>>> = {
  mp4: {
    video: 'libx264',
    audio: 'aac',
    extra: ['-movflags', '+faststart', '-pix_fmt', 'yuv420p'],
    mimeType: 'video/mp4',
  },
  mov: {
    video: 'libx264',
    audio: 'aac',
    extra: ['-pix_fmt', 'yuv420p'],
    mimeType: 'video/quicktime',
  },
  mkv: {
    video: 'libx264',
    audio: 'aac',
    extra: ['-pix_fmt', 'yuv420p'],
    mimeType: 'video/x-matroska',
  },
  webm: {
    video: 'libvpx-vp9',
    // Opus rather than the Vorbis ffmpeg would pick on its own: every current
    // browser decodes Opus, and Safari refuses Vorbis in WebM.
    audio: 'libopus',
    extra: ['-pix_fmt', 'yuv420p'],
    constantQuality: ['-b:v', '0'],
    mimeType: 'video/webm',
  },
  avi: { video: 'libx264', audio: 'libmp3lame', mimeType: 'video/x-msvideo' },
  mp3: { video: null, audio: 'libmp3lame', mimeType: 'audio/mpeg' },
  m4a: { video: null, audio: 'aac', extra: ['-movflags', '+faststart'], mimeType: 'audio/mp4' },
  aac: { video: null, audio: 'aac', mimeType: 'audio/aac' },
  ogg: { video: null, audio: 'libopus', mimeType: 'audio/ogg' },
  // 16-bit little-endian PCM: the only WAV anything reads without argument.
  wav: { video: null, audio: 'pcm_s16le', mimeType: 'audio/wav' },
  flac: { video: null, audio: 'flac', mimeType: 'audio/flac' },
}

/** Whether this engine can write `format` at all. */
export function isFfmpegTarget(format: FormatId): boolean {
  return FFMPEG_TARGETS[format] !== undefined
}

/** What `format` compiles to, or an error naming what the engine does write. */
export function ffmpegTargetFor(format: FormatId): FfmpegTarget {
  const target = FFMPEG_TARGETS[format]
  if (target === undefined) {
    throw new Error(
      `The conversion engine cannot write ${format.toUpperCase()} files. It writes ` +
        `${Object.keys(FFMPEG_TARGETS).join(', ').toUpperCase()}.`,
    )
  }

  return target
}

export interface FfmpegJob {
  input: string
  output: string
  /** The source format the router routed on, used to name the input in MEMFS. */
  from: FormatId
  to: FormatId
  /** `extract` drops the picture and keeps the sound, whatever the container had. */
  keepVideo: boolean
  video?: VideoOptions
  audio?: AudioOptions
  /**
   * How long the source runs, in seconds, where the caller could find out.
   *
   * Only the target-size method needs it, and only that method fails without
   * it: see `resolveVideoEncode`. A parameter and not a probe, because this
   * module is pure. `runFfmpeg` asks ffmpeg itself and passes the answer down.
   */
  durationSeconds?: number
}

/**
 * The whole command line, in order.
 *
 * The order is ffmpeg's own and not negotiable: global flags, then the input,
 * then the output's stream selection and codecs, then the output file. An
 * option placed after the output file applies to nothing.
 */
export function ffmpegArgs(job: FfmpegJob): string[] {
  const target = ffmpegTargetFor(job.to)
  const wantsVideo = job.keepVideo && target.video !== null
  const audioBitrate = resolveAudioBitrate(job.audio, channelsFor(job.audio))

  // Resolved once, here, so that the sizing method and the audio rate it has to
  // make room for are decided together rather than in two places that could
  // disagree about how many bits the sound costs.
  const encode = resolveVideoEncode(job.video, {
    durationSeconds: job.durationSeconds ?? 0,
    audioBitrate,
  })

  const args = ['-i', job.input]

  if (wantsVideo) {
    args.push('-c:v', target.video as string, ...videoQuality(encode, target))

    const scale = scaleFilter(encode)
    if (scale !== null) args.push('-vf', scale)

    if (isPositive(encode.frameRate)) args.push('-r', String(encode.frameRate))
  } else {
    // Explicit, not implied. ffmpeg copies a video stream into an MP3 quite
    // happily — as an attached picture at best, as an unplayable file at worst.
    args.push('-vn')
  }

  args.push('-c:a', target.audio)
  if (target.audio !== 'pcm_s16le' && target.audio !== 'flac') {
    args.push('-b:a', String(audioBitrate))
  }

  if (target.extra !== undefined) args.push(...target.extra)

  args.push(job.output)

  return args
}

/**
 * How hard to compress the picture, in ffmpeg's own vocabulary.
 *
 * Three shapes, one per answer `resolveVideoEncode` can give:
 *
 * - a fixed `-b:v`, which is what a target size and a chosen bitrate both become
 * - `-crf` with `-maxrate` and a `-bufsize` of twice it: *constrained quality*,
 *   x264's documented way to say "as good as you can, but never above this".
 *   The buffer has to be larger than the ceiling, or the encoder cannot spend a
 *   burst on a hard scene and the picture stutters instead.
 * - `-crf` alone, which is constant quality and the right default: a fixed rate
 *   applied to a video that did not need it wastes bits on an easy scene and
 *   starves a hard one.
 */
function videoQuality(encode: ResolvedVideoEncode, target: FfmpegTarget): string[] {
  if (isPositive(encode.bitrate)) {
    return ['-b:v', String(Math.round(encode.bitrate)), '-preset', DEFAULT_PRESET]
  }

  const quality = ['-crf', String(encode.crf ?? DEFAULT_CRF), ...(target.constantQuality ?? [])]

  if (isPositive(encode.maxBitrate)) {
    const ceiling = Math.round(encode.maxBitrate)

    return [
      ...quality,
      '-maxrate',
      String(ceiling),
      '-bufsize',
      String(ceiling * 2),
      '-preset',
      DEFAULT_PRESET,
    ]
  }

  return [...quality, '-preset', DEFAULT_PRESET]
}

/**
 * The `scale` filter for a requested size, or `null` for none.
 *
 * `-2` on the unconstrained axis rather than `-1`: both keep the aspect ratio,
 * and `-2` additionally rounds to an even number, which every codec here
 * requires and `-1` does not guarantee. `force_original_aspect_ratio=decrease`
 * makes a two-axis request a box to fit inside rather than a stretch.
 */
export function scaleFilter(size: { width?: number; height?: number } | undefined): string | null {
  const width = positiveInteger(size?.width)
  const height = positiveInteger(size?.height)

  if (width === undefined && height === undefined) return null
  if (width !== undefined && height !== undefined) {
    return `scale=${width}:${height}:force_original_aspect_ratio=decrease,scale=trunc(iw/2)*2:trunc(ih/2)*2`
  }

  return width === undefined ? `scale=-2:${height}` : `scale=${width}:-2`
}

function channelsFor(options: AudioOptions | undefined): number {
  const channels = positiveInteger(options?.channels)

  return channels ?? 2
}

function isPositive(value: number | undefined): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
}

function positiveInteger(value: number | undefined): number | undefined {
  return isPositive(value) ? Math.round(value) : undefined
}
