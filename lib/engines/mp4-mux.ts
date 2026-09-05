/**
 * Writing an MP4 from tracks and samples that already exist.
 *
 * The mirror of `./mp4-demux`, and the other half of "without re-encoding": what
 * comes out is a new container around the *same* encoded bytes. Nothing here
 * looks inside a sample, and the codec configuration goes back in as the exact
 * box it came out of (`./mp4-runtime`'s `rawBox`), so a video that arrived as
 * H.265 leaves as H.265 with its parameter sets intact — even though nothing in
 * this project knows what an `hvcC` contains.
 *
 * ## Where the sample entry type comes from
 *
 * A track's four-character sample entry — `avc1`, `hvc1`, `mp4a` — is the first
 * component of its RFC 6381 codec string, which is exactly how the string is
 * defined. Reading it off the codec string rather than keeping a table means a
 * codec this project has never seen still round-trips, and the table that would
 * have to be maintained does not exist.
 *
 * ## Timescales are per track and are not touched
 *
 * A 30000/1001 video track and a 48 kHz audio track have unrelated timescales,
 * and every timestamp travels in its own. Normalising them to a shared one would
 * introduce rounding into a path whose whole promise is that nothing changes.
 */

import { throwIfAborted } from '@/lib/abort'

import type { Mp4Media, Mp4Track } from './mp4-media'
import {
  loadMp4Box,
  type Mp4BoxLoader,
  type Mp4File,
  type Mp4TrackOptions,
  rawBox,
  writtenBytes,
} from './mp4-runtime'

/** How often the sample loop looks at the abort signal. */
const CANCEL_INTERVAL = 500

/** What a track with no stated language is labelled. ISO 639-2/T for "undetermined". */
const UNDETERMINED = 'und'

/** Every sample entry code is exactly four characters. See {@link sampleEntryType}. */
const FOUR_CHARACTER_CODE = 4

/**
 * Writes `media` as a single MP4.
 *
 * Rejects a job with no tracks rather than producing a container with nothing in
 * it: a zero-track MP4 is a valid file that no player will open, which is the
 * worst kind of success.
 */
export async function writeMp4(
  media: Mp4Media,
  signal: AbortSignal,
  load: Mp4BoxLoader = loadMp4Box,
): Promise<Uint8Array<ArrayBuffer>> {
  throwIfAborted(signal)

  if (media.tracks.length === 0) {
    throw new Error('There is nothing to write: the job produced no video and no audio track.')
  }

  const mp4 = await load()
  throwIfAborted(signal)

  const file = mp4.createFile()

  for (const track of media.tracks) {
    const trackId = file.addTrack(trackOptions(track))
    writeSamples(file, trackId, track, signal)
  }

  throwIfAborted(signal)

  return writtenBytes(file)
}

function writeSamples(file: Mp4File, trackId: number, track: Mp4Track, signal: AbortSignal): void {
  for (const [index, sample] of track.samples.entries()) {
    if (index % CANCEL_INTERVAL === 0) throwIfAborted(signal)

    file.addSample(trackId, sample.data, {
      duration: sample.duration,
      dts: sample.dts,
      cts: sample.cts,
      is_sync: sample.isSync,
    })
  }
}

function trackOptions(track: Mp4Track): Mp4TrackOptions {
  const { format } = track
  const description =
    format.description === undefined
      ? undefined
      : [rawBox(format.description, format.descriptionType ?? sampleEntryType(format.codec))]

  const common = {
    type: sampleEntryType(format.codec),
    timescale: format.timescale,
    // Stated rather than left out: mp4box's own default is `fr-FR`, which would
    // label every file this tool writes as French.
    language: format.language ?? UNDETERMINED,
    description_boxes: description,
  }

  if (track.kind === 'video') {
    return { ...common, width: format.width ?? 0, height: format.height ?? 0 }
  }

  return {
    ...common,
    hdlr: 'soun',
    name: 'SoundHandler',
    channel_count: format.channelCount ?? 2,
    samplerate: format.sampleRate ?? format.timescale,
    // Sixteen bits per sample is what every sample entry in the wild declares
    // for a compressed audio track; the field describes the *uncompressed* form
    // and no decoder reads it.
    samplesize: 16,
  }
}

/**
 * The sample entry type for a codec string.
 *
 * RFC 6381 defines the string as the sample entry's four-character code
 * followed by codec-specific parameters after a full stop, so the first
 * component *is* the answer. A string with no full stop is already the code.
 *
 * A code that *begins* with a full stop is the exception the rule creates:
 * `.mp3` is a real sample entry, four characters long, whose first component is
 * empty. Splitting it and refusing the empty half turned a file this can copy
 * perfectly into a failure (issue #277).
 *
 * Anything else is not a code at all, and the sentence for it names what was
 * found and a target that works — a track whose codec cannot go into an ISO
 * container has to be re-encoded, and MP3 and WAV are where that happens.
 */
export function sampleEntryType(codec: string): string {
  const [first] = codec.split('.')

  if (codec.length === FOUR_CHARACTER_CODE && first === '') return codec

  if (first === undefined || first.length !== FOUR_CHARACTER_CODE) {
    throw new Error(
      `This file holds a track stored as “${codec}”, which is not a four-character code an MP4 ` +
        'sample entry can carry, so it cannot be copied into a new container. Convert it to MP3 ' +
        'or WAV instead, which re-encode the audio rather than copy it.',
    )
  }

  return first
}
