/**
 * Reading an MP4: tracks out, samples out, nothing decoded.
 *
 * Demuxing is the half of video work that is pure bookkeeping. The container
 * says where each encoded frame starts, how long it lasts and which of them are
 * keyframes; a demuxer hands those out and never looks inside one. That is what
 * makes a container conversion possible *without re-encoding*, and it is why
 * this layer exists before either codec path (issues #47 and #48) does.
 *
 * ## Why it is one pass and not two
 *
 * Everything happens inside a single `appendBuffer` / `flush`, from mp4box's own
 * `onReady` callback outwards. That is not a style choice: extraction has to be
 * armed *before* the file is flushed, because flushing is what tells the library
 * it may let go of the buffered bytes. Arming it afterwards — the obvious shape,
 * where parsing resolves a promise and extraction is a second step — produces a
 * file that parses perfectly and then yields no samples at all.
 *
 * ## Memory
 *
 * Every sample is collected before the promise settles, so the live set is the
 * file's own encoded size plus mp4box's index. That is well inside the 2.5×
 * `MEMORY.webcodecs` allows in `lib/router/budget.ts` — that factor is sized for
 * the decoded frames a transcode holds, which are far larger than this. A job
 * that wanted to stream samples through a codec without ever holding them all
 * would need a different shape, and can have one when there is a caller for it.
 *
 * ## What it does not do
 *
 * Fragmented MP4, encrypted tracks, and every track that is neither video nor
 * audio — subtitles, timecode, chapter tracks. Each is dropped rather than
 * mishandled, and a file with no usable track at all fails with a sentence that
 * says so.
 */

import { throwIfAborted } from '@/lib/abort'

import type { Mp4Media, Mp4Sample, Mp4TrackFormat } from './mp4-media'
import {
  BIG_ENDIAN,
  loadMp4Box,
  type Mp4Box,
  type Mp4BoxLoader,
  type Mp4BoxModule,
  type Mp4File,
  type Mp4RawSample,
  type Mp4TrackInfo,
} from './mp4-runtime'

/**
 * How many samples mp4box hands over per callback.
 *
 * Large enough that a two-hour film is a few hundred callbacks rather than two
 * hundred thousand, and small enough that the library is not building one
 * enormous array before the first one arrives.
 */
const SAMPLES_PER_BATCH = 1000

/**
 * The boxes that carry a codec's private configuration.
 *
 * Recognised by name and then carried as opaque bytes — see
 * `Mp4TrackFormat.description`. The list is what a sample entry may hold rather
 * than what this project can decode: an `av1C` is copied through a remux
 * perfectly well by a layer that has never heard of AV1.
 */
const CONFIGURATION_BOXES: ReadonlySet<string> = new Set([
  'avcC',
  'hvcC',
  'vvcC',
  'av1C',
  'vpcC',
  'esds',
  'dOps',
  'dfLa',
])

/**
 * Reads `bytes` and returns its video and audio tracks with every sample.
 *
 * Rejects — rather than resolving with nothing — for a file mp4box cannot parse
 * and for one whose tracks are all of kinds this does not handle, because both
 * are things the user has to be told about rather than discover from an empty
 * result.
 */
export async function readMp4(
  bytes: Uint8Array,
  signal: AbortSignal,
  load: Mp4BoxLoader = loadMp4Box,
): Promise<Mp4Media> {
  throwIfAborted(signal)

  const mp4 = await load()
  throwIfAborted(signal)

  const media = await readInOnePass(mp4, bytes)
  throwIfAborted(signal)

  return media
}

function readInOnePass(mp4: Mp4BoxModule, bytes: Uint8Array): Promise<Mp4Media> {
  return new Promise((resolve, reject) => {
    const file = mp4.createFile()
    const collected = new Map<number, Mp4Sample[]>()
    let wanted: readonly Mp4TrackInfo[] | null = null

    const finish = () => {
      // Non-null wherever this is reached: it runs only after `onReady`.
      const tracks = wanted ?? []

      resolve({
        tracks: tracks.map((track) => ({
          id: track.id,
          // Non-null by construction: `wanted` is exactly the tracks with a kind.
          kind: kindOf(track) as 'video' | 'audio',
          format: formatOf(mp4, file, track),
          samples: collected.get(track.id) ?? [],
        })),
      })
    }

    const complete = () =>
      (wanted ?? []).every((track) => (collected.get(track.id)?.length ?? 0) >= track.nb_samples)

    file.onError = (where, message) => reject(unreadable(`${where}: ${message}`))

    file.onReady = (info) => {
      const usable = info.tracks.filter((track) => kindOf(track) !== null)
      if (usable.length === 0) {
        reject(noUsableTracks(info.tracks.length))

        return
      }

      wanted = usable
      for (const track of usable) collected.set(track.id, [])

      // Armed here, inside `onReady`, and not after the promise it would
      // otherwise resolve: see the module header.
      for (const track of usable) {
        file.setExtractionOptions(track.id, null, { nbSamples: SAMPLES_PER_BATCH })
      }
      file.start()
    }

    file.onSamples = (id, _user, samples) => {
      const into = collected.get(id)
      if (into === undefined) return

      for (const sample of samples) into.push(convert(sample))
      if (complete()) file.stop()
    }

    // A copy, because mp4box keeps the buffer and expects to own it — and
    // because `bytes` may be a view onto a larger one.
    const copy = new Uint8Array(bytes.length)
    copy.set(bytes)

    try {
      file.appendBuffer(mp4.MP4BoxBuffer.fromArrayBuffer(copy.buffer, 0))
      file.flush()
    } catch (reason) {
      reject(unreadable(reason instanceof Error ? reason.message : String(reason)))

      return
    }

    if (wanted === null) {
      // Nothing threw and `onReady` never fired: the bytes parsed as *something*
      // but never produced a movie header, which is what a truncated download and
      // a file that was never an MP4 both look like.
      reject(unreadable('no movie header was found'))

      return
    }

    if (!complete()) {
      // Short counts mean the sample index disagrees with the data, which is a
      // damaged file rather than one this cannot read.
      reject(unreadable('the sample index does not match the data'))

      return
    }

    finish()
  })
}

function convert(sample: Mp4RawSample): Mp4Sample {
  // Copied out of mp4box's buffer: it releases sample data as the extraction
  // moves on, and a view onto released memory decodes as noise.
  const data = new Uint8Array(sample.data.length)
  data.set(sample.data)

  return {
    data,
    dts: sample.dts,
    cts: sample.cts,
    duration: sample.duration,
    isSync: sample.is_sync,
  }
}

function formatOf(mp4: Mp4BoxModule, file: Mp4File, track: Mp4TrackInfo): Mp4TrackFormat {
  const entry = file.getTrackById(track.id)?.mdia.minf.stbl.stsd.entries[0]
  const configuration = entry?.boxes?.find((box) => CONFIGURATION_BOXES.has(box.type))

  return {
    codec: track.codec,
    timescale: track.timescale,
    language: track.language,
    description: configuration === undefined ? undefined : boxBytes(mp4, configuration),
    descriptionType: configuration?.type,
    width: track.video?.width,
    height: track.video?.height,
    channelCount: track.audio?.channel_count,
    sampleRate: track.audio?.sample_rate,
  }
}

/** One box written back out, header and all, exactly as it will be put back. */
function boxBytes(mp4: Mp4BoxModule, box: Mp4Box): Uint8Array<ArrayBuffer> {
  const stream = new mp4.DataStream(undefined, 0, BIG_ENDIAN)
  box.write(stream)

  const written = new Uint8Array(stream.buffer)
  const out = new Uint8Array(written.length)
  out.set(written)

  return out
}

function kindOf(track: Mp4TrackInfo): 'video' | 'audio' | null {
  if (track.video !== undefined) return 'video'
  if (track.audio !== undefined) return 'audio'

  return null
}

function unreadable(detail: string): Error {
  return new Error(
    `This video could not be read (${detail}). If it was downloaded, check that the download ` +
      'completed; if it came off a camera, try copying it again rather than moving it.',
  )
}

function noUsableTracks(total: number): Error {
  return new Error(
    total === 0
      ? 'This file has no tracks in it at all, so there is nothing to convert.'
      : `This file has ${total} track${total === 1 ? '' : 's'}, none of which is video or audio. ` +
          'Subtitle and timecode tracks cannot be converted on their own.',
  )
}
