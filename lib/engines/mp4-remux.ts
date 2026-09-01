/**
 * Moving tracks between ISO base media containers without touching a codec.
 *
 * The whole pipeline is `./mp4-demux` into `./mp4-mux` with a filter in the
 * middle. Nothing is decoded, nothing is re-encoded, and every sample arrives at
 * the muxer as the exact bytes the demuxer read — which is what makes the
 * operation lossless and near-instant. Reading a 2 GB film is bookkeeping over
 * its sample index; re-encoding one is minutes of a GPU's time.
 *
 * ## Why the selection is a set of kinds and not a track list
 *
 * The two jobs that need this — pulling the sound out of a video, and changing a
 * container's brand — differ in exactly one way: which kinds of track survive.
 * Everything else about them is identical, so the parameter is the difference
 * and nothing more. A caller that wanted a specific track id would be asking for
 * an editor, which this is not.
 *
 * ## What is deliberately not carried
 *
 * Whatever the demuxer already drops: fragmented input, encrypted tracks, and
 * every track that is neither video nor audio. Subtitles and chapter markers do
 * not survive a remux here, and a file made only of them fails in `./mp4-demux`
 * with a sentence that says so.
 */

import { throwIfAborted } from '@/lib/abort'

import { readMp4 } from './mp4-demux'
import type { Mp4Media, Mp4Track } from './mp4-media'
import { writeMp4 } from './mp4-mux'
import type { Mp4BoxLoader } from './mp4-runtime'
import type { ProgressCallback } from './types'

/** Share of the bar the demux accounts for; the write is the rest. */
const DEMUXED = 0.6

export interface RemuxOptions {
  /**
   * The track kinds that survive the copy.
   *
   * `['audio']` is an extraction, `['video', 'audio']` a container change. A
   * kind that is asked for and not present is not an error on its own — a silent
   * film remuxes fine — but a job that keeps *nothing* is, which is the check
   * below.
   */
  keep: readonly Mp4Track['kind'][]
}

export interface RemuxDependencies {
  loadMp4Box?: Mp4BoxLoader
}

/**
 * Copies the wanted tracks of `bytes` into a fresh MP4.
 *
 * Rejects rather than returning an empty container when nothing survives the
 * filter: an MP4 with no tracks is a valid file that no player opens, and
 * "nothing went wrong, here is a file that does not work" is the worst outcome
 * available.
 */
export async function remuxMp4(
  bytes: Uint8Array,
  options: RemuxOptions,
  signal: AbortSignal,
  onProgress: ProgressCallback,
  dependencies: RemuxDependencies = {},
): Promise<Uint8Array<ArrayBuffer>> {
  const { loadMp4Box } = dependencies

  throwIfAborted(signal)
  // Indeterminate while the index is parsed: mp4box reports nothing until it has
  // the whole sample table, which on a long film is a second or two of silence.
  onProgress(-1)

  const media = await readMp4(bytes, signal, loadMp4Box)
  throwIfAborted(signal)
  onProgress(DEMUXED)

  const kept = media.tracks.filter((track) => options.keep.includes(track.kind))
  if (kept.length === 0) throw nothingToCopy(media, options)

  // Track ids are renumbered from 1 by the muxer's `addTrack`; the demuxed ids
  // are only meaningful inside the file they came from.
  const written = await writeMp4({ tracks: kept }, signal, loadMp4Box)

  onProgress(1)

  return written
}

/**
 * The sentence for a file that has none of the tracks the job wanted.
 *
 * Names what the file *does* have, because "no audio track" on its own leaves
 * the user guessing whether they picked the wrong file or the wrong tool. The
 * list is never empty: `readMp4` has already refused a file with no video and no
 * audio track in it, with a message of its own.
 */
function nothingToCopy(media: Mp4Media, options: RemuxOptions): Error {
  const wanted = options.keep.join(' or ')
  const present = [...new Set(media.tracks.map((track) => track.kind))]

  return new Error(
    `This file has no ${wanted} track in it — only ${present.join(' and ')}. ` +
      'Check that the file is the one you meant to convert.',
  )
}
