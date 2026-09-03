/**
 * Letting go of demuxed samples while they are still being used.
 *
 * `./mp4-demux` collects every encoded sample of a track before it resolves, so
 * a transcode starts with one whole copy of the file's payload in hand. It then
 * builds a second one — the encoder's output — and, unless something drops the
 * first, both are live when the muxer runs. That is one copy of the file more
 * than the pipeline needs, and `MEMORY.webcodecs` in `lib/router/budget.ts` is
 * the table that has to price it.
 *
 * The copy is avoidable because the transcode loop reads the source strictly
 * once, in order, and never looks back. {@link drainSamples} is that read: it
 * takes ownership of the array away from the track and clears each slot as the
 * sample leaves, so a sample the decoder has already swallowed is garbage the
 * moment the codec is done with it rather than at the end of the job.
 *
 * ## Why it is a module and not four lines in the loop
 *
 * Because both transcodes need it — video and audio — and because "the array is
 * emptied as it is iterated" is exactly the kind of thing that reads as a bug
 * when it is inlined and as a decision when it is named. It is also the only
 * part of the memory claim that can be tested without a browser.
 */

import type { Mp4Media, Mp4Sample, Mp4Track } from './mp4-media'

/**
 * What a released slot is set to.
 *
 * A shared, empty sample rather than `undefined` or `delete`. Both of those turn
 * a packed array into one with holes, which V8 handles through a slower path for
 * the rest of the array's life; one frozen object costs nothing and keeps the
 * array's shape. Nothing ever reads it — {@link drainSamples} hands over the
 * value it took *before* overwriting the slot.
 */
const RELEASED: Mp4Sample = Object.freeze({
  data: new Uint8Array(0),
  dts: 0,
  cts: 0,
  duration: 0,
  isSync: false,
})

/** One track's samples, handed over once and released on the way out. */
export interface SampleStream {
  /** How many there were, for the progress fraction the caller reports. */
  readonly total: number
  /** How many are still held. Falls to zero as {@link samples} is consumed. */
  readonly remaining: number
  /**
   * Every sample, in order, exactly once.
   *
   * Iterating it a second time yields nothing: the samples are gone, which is
   * the point. A caller that needs to look at the track twice — `planVideoEncode`
   * reads the sample timings before a codec is configured — has to do so before
   * the stream is created.
   */
  readonly samples: Iterable<Mp4Sample>
}

/**
 * Takes `track`'s samples and returns them as a stream that releases as it goes.
 *
 * The track is left with an empty array rather than the one it came with, so
 * the only reference to the list is the stream, and the only reference to each
 * sample is the caller's own loop variable.
 */
export function drainSamples(track: Mp4Track): SampleStream {
  const held = track.samples
  track.samples = []

  let cursor = 0

  return {
    total: held.length,
    get remaining() {
      return held.length - cursor
    },
    samples: {
      *[Symbol.iterator]() {
        while (cursor < held.length) {
          const sample = held[cursor]
          // Cleared before the yield, not after: a caller that breaks out of
          // the loop mid-way should not leave the sample it was given still
          // reachable from the array as well.
          held[cursor] = RELEASED
          cursor += 1

          yield sample
        }
      },
    },
  }
}

/**
 * Drops every track of `media` except `keep`, and empties the ones it drops.
 *
 * A transcode reads one track. The others — an audio track alongside the video
 * being converted, most often — were demuxed into memory anyway, and they stay
 * there for the whole job because `media` is still on the stack. Emptying them
 * as well as unlinking them matters: whoever handed the media over may still
 * hold a reference to a `Mp4Track` object, and an unlinked track with its
 * samples intact is the same megabytes under a different name.
 */
export function keepOnlyTrack(media: Mp4Media, keep: Mp4Track): void {
  for (const track of media.tracks) {
    if (track !== keep) track.samples = []
  }

  media.tracks = [keep]
}
