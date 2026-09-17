/**
 * What the router knows about formats themselves, apart from any engine.
 *
 * Three questions are asked of a format pair while a job is routed, and none of
 * them is about a device or a candidate list: which family of codecs the job
 * drives, whether writing the target throws information away, and whether the
 * target keeps the words and discards the document. `./route` asks the first to
 * decide viability and `./warnings` asks the other two to decide what to say,
 * so the tables live here rather than in either — a second copy of "is MP4
 * lossy" is how one screen warns about quality and the next one does not.
 *
 * Pure data and pure predicates: no `Capabilities`, no engine, no file.
 */

import type { ConversionTask, FormatId } from './types'

const VIDEO_FORMATS: ReadonlySet<FormatId> = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])
const AUDIO_FORMATS: ReadonlySet<FormatId> = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const LOSSY_IMAGE_FORMATS: ReadonlySet<FormatId> = new Set(['jpg', 'webp', 'avif', 'gif', 'heic'])
const LOSSLESS_AUDIO_FORMATS: ReadonlySet<FormatId> = new Set(['wav', 'flac'])

/**
 * Targets that keep the words and throw the document away.
 *
 * A different loss from `QUALITY_LOSS`, which is about re-encoding: nothing is
 * being re-encoded here, and nothing about the *text* degrades. What is lost is
 * everything that was not text — the layout, the fonts, the images, the tables —
 * because the target format has nowhere to put any of it.
 */
export const TEXT_FORMATS: ReadonlySet<FormatId> = new Set(['txt'])

/**
 * Whether writing this format throws information away.
 *
 * WebP, AVIF and HEIC all have lossless modes on paper; every engine we ship
 * writes them lossily by default, so they count as lossy here. Video containers
 * are lossy because the codecs inside them are.
 */
export function isLossy(format: FormatId): boolean {
  if (LOSSY_IMAGE_FORMATS.has(format) || VIDEO_FORMATS.has(format)) return true
  return AUDIO_FORMATS.has(format) && !LOSSLESS_AUDIO_FORMATS.has(format)
}

/**
 * Which family of codecs the job has to drive, or `null` when it drives none.
 *
 * Writing a video format always needs video codecs. Reading one usually does
 * too — except when the output is audio, which is a demux plus an audio
 * transcode, the video stream discarded untouched.
 */
export function codecKind(task: ConversionTask): 'video' | 'audio' | null {
  if (VIDEO_FORMATS.has(task.to)) return 'video'
  if (VIDEO_FORMATS.has(task.from)) return AUDIO_FORMATS.has(task.to) ? 'audio' : 'video'
  if (AUDIO_FORMATS.has(task.from) || AUDIO_FORMATS.has(task.to)) return 'audio'
  return null
}
