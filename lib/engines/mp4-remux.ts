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
  /**
   * Whether the audio that survives has to be AAC.
   *
   * Set for an extraction, and only for one. The output of that job is an M4A,
   * and an M4A is AAC by convention — a file labelled `audio/mp4` holding
   * Dolby Digital is one most decoders refuse to open, which makes "the copy
   * succeeded" a lie told in a file the user cannot play (issue #277). A
   * container change makes no such promise: it promises the box and never the
   * codec, so an AC-3 MOV becomes an AC-3 MP4 and that is exactly right.
   */
  audioMustBeAac?: boolean
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
  if (options.audioMustBeAac === true) refuseAudioThatIsNotAac(kept)

  // Track ids are renumbered from 1 by the muxer's `addTrack`; the demuxed ids
  // are only meaningful inside the file they came from.
  const written = await writeMp4({ tracks: kept }, signal, loadMp4Box)

  onProgress(1)

  return written
}

/**
 * The sample entry every AAC track carries, and the only audio an M4A may hold.
 *
 * The four-character code alone, because the parameters after it vary and none
 * of them changes the answer: mp4box reports `mp4a.40.2` for AAC-LC,
 * `mp4a.40.5` for HE-AAC and `mp4a` alone where the descriptor was thin, and
 * all three are the same copy.
 */
const AAC_SAMPLE_ENTRY = 'mp4a'

/**
 * The object type indications an `mp4a` may carry that are not AAC after all.
 *
 * `mp4a` is the sample entry for everything MPEG-4 describes with an `esds`,
 * not for AAC alone: `0x6b` is MPEG-1 audio, which is MP3, and `0x69` its
 * MPEG-2 revision. mp4box reports both as `mp4a.6b` and `mp4a.69`, so the
 * four-character code on its own does not settle the question.
 */
const NOT_AAC_OBJECT_TYPES: ReadonlySet<string> = new Set(['69', '6b'])

/**
 * What to call a codec in a sentence a person reads.
 *
 * Short on purpose: the codes here are the ones that actually turn up in an MP4
 * or a MOV whose sound is not AAC — a TV capture, a DVD rip, an Apple Lossless
 * library, a QuickTime file with raw PCM in it. Anything else falls back to its
 * four-character code, which is still better than "unsupported": it is a string
 * the user can search for.
 */
const AUDIO_CODEC_NAMES: Readonly<Record<string, string>> = {
  'ac-3': 'AC-3 (Dolby Digital)',
  'ac-4': 'AC-4',
  'ec-3': 'E-AC-3 (Dolby Digital Plus)',
  alac: 'Apple Lossless',
  dmlp: 'Dolby TrueHD',
  dtsc: 'DTS',
  dtse: 'DTS Express',
  dtsh: 'DTS-HD',
  dtsl: 'DTS-HD Master Audio',
  fLaC: 'FLAC',
  lpcm: 'uncompressed PCM',
  mp3: 'MP3',
  '.mp3': 'MP3',
  'mp4a.69': 'MP3',
  'mp4a.6b': 'MP3',
  Opus: 'Opus',
  sowt: 'uncompressed PCM',
  twos: 'uncompressed PCM',
}

/**
 * Turns away a soundtrack that cannot be copied, before a file is written.
 *
 * The router cannot see inside a file — it has a format pair and a size and
 * nothing else — so `/convert/mp4-to-m4a` sends a Dolby Digital TV capture down
 * the copy path exactly as it sends an ordinary AAC one. This is the first
 * place that knows, and the last place that can say so.
 */
function refuseAudioThatIsNotAac(kept: readonly Mp4Track[]): void {
  // Every kept track, not the first one: a file with a second soundtrack copies
  // both, and one bad track is enough to make the result unplayable.
  const foreign = kept.find((track) => track.kind === 'audio' && !isAac(track.format.codec))
  if (foreign === undefined) return

  throw new Error(
    `This file’s sound is ${audioCodecName(foreign.format.codec)}, which an M4A cannot hold, so ` +
      'it cannot be copied out of the video unchanged. Convert it to MP3 or WAV instead — both ' +
      're-encode the audio rather than copy it, so they take any soundtrack.',
  )
}

/** A bare `mp4a` with no object type stated is taken at its word. */
function isAac(codec: string): boolean {
  const [entry, objectType] = codec.split('.')
  if (entry !== AAC_SAMPLE_ENTRY) return false

  return objectType === undefined || !NOT_AAC_OBJECT_TYPES.has(objectType.toLowerCase())
}

/**
 * Three lookups, narrowing: the whole string, then the sample entry with its
 * object type, then the sample entry alone.
 *
 * The middle one is what makes MP3-in-MP4 readable, because mp4box reports it
 * as `mp4a.6b.2` — entry, object type, and a decoder-specific byte after it.
 * The whole string is tried first because `.mp3` splits into an empty
 * component and is only itself.
 */
function audioCodecName(codec: string): string {
  const [entry = '', objectType] = codec.split('.')
  const qualified = objectType === undefined ? entry : `${entry}.${objectType.toLowerCase()}`

  return (
    AUDIO_CODEC_NAMES[codec] ?? AUDIO_CODEC_NAMES[qualified] ?? AUDIO_CODEC_NAMES[entry] ?? codec
  )
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
