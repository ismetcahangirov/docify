/**
 * What an MP4 looks like once the container is off: tracks, and the encoded
 * samples inside them.
 *
 * Types only, so the demuxer, the muxer and everything downstream of them share
 * one vocabulary without any of them importing another. The shape is chosen to
 * sit directly next to WebCodecs — a {@link Mp4Sample} is what an
 * `EncodedVideoChunk` is built from, and a {@link Mp4TrackFormat} is most of a
 * `VideoDecoderConfig` — because the whole point of reading a container is to
 * hand its contents to a codec.
 *
 * ## Timestamps are in the track's own units
 *
 * Every number below is in `timescale` ticks, not seconds and not microseconds.
 * That is how the file stores them, and converting on the way in would throw
 * away precision the container was careful about: a 30000/1001 video track has a
 * frame duration of exactly 1001 ticks and nothing near a round number of
 * microseconds. The conversion belongs at the WebCodecs boundary, once, where it
 * can be done deliberately.
 */

/** One encoded frame or audio packet, exactly as it sat in the file. */
export interface Mp4Sample {
  /** The encoded bytes. Never decoded, never re-encoded, never inspected. */
  data: Uint8Array
  /** Decode timestamp, in the track's timescale. */
  dts: number
  /**
   * Composition (presentation) timestamp, in the track's timescale.
   *
   * Differs from {@link dts} wherever a codec reorders frames — B-frames are
   * decoded before the frames they sit between and displayed after them — which
   * is why both are carried rather than one.
   */
  cts: number
  /** How long the sample is shown or heard, in the track's timescale. */
  duration: number
  /** A keyframe: decodable without anything before it. */
  isSync: boolean
}

/** Everything a decoder needs to know about a track before its first sample. */
export interface Mp4TrackFormat {
  /** The RFC 6381 string, e.g. `avc1.64001f` or `mp4a.40.2`. */
  codec: string
  /** Ticks per second, the unit every timestamp on this track is in. */
  timescale: number
  /**
   * The codec's private configuration, as the *complete box* it was stored in —
   * header included.
   *
   * Kept whole and opaque on purpose. An `avcC` holds the sequence and picture
   * parameter sets, an `esds` holds a descriptor tree with the AudioSpecificConfig
   * buried inside it, and an `av1C` is something else again; a layer whose job is
   * to move samples between containers has no business understanding any of them.
   * Putting the same bytes back is what makes a remux lossless. Whoever hands the
   * track to WebCodecs unwraps it — see {@link descriptionType} for which box it
   * is.
   */
  description?: Uint8Array
  /** The four-character type of {@link description}: `avcC`, `esds`, and so on. */
  descriptionType?: string
  /** ISO 639-2/T, or `und` where the file did not say. */
  language?: string
  width?: number
  height?: number
  channelCount?: number
  sampleRate?: number
}

export interface Mp4Track {
  /** The track id the file used. Preserved so a remux keeps its references. */
  id: number
  kind: 'video' | 'audio'
  format: Mp4TrackFormat
  samples: Mp4Sample[]
}

/** One file's worth of tracks, in the order the container listed them. */
export interface Mp4Media {
  tracks: Mp4Track[]
}

/** The one video track, or `undefined` for an audio-only file. */
export function videoTrack(media: Mp4Media): Mp4Track | undefined {
  return media.tracks.find((track) => track.kind === 'video')
}

/** The one audio track, or `undefined` for a silent file. */
export function audioTrack(media: Mp4Media): Mp4Track | undefined {
  return media.tracks.find((track) => track.kind === 'audio')
}
