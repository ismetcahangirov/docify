// @vitest-environment node

import { describe, expect, it } from 'vitest'

import type { Mp4Media, Mp4Sample, Mp4Track } from '@/lib/engines/mp4-media'
import { drainSamples, keepOnlyTrack, keepOnlyTracks } from '@/lib/engines/mp4-samples'

/** `count` samples, each carrying a distinguishable buffer of `bytes` bytes. */
function samples(count: number, bytes = 16): Mp4Sample[] {
  return Array.from({ length: count }, (_, index) => ({
    data: new Uint8Array(bytes).fill(index + 1),
    dts: index * 100,
    cts: index * 100,
    duration: 100,
    isSync: index === 0,
  }))
}

function videoTrackOf(count: number): Mp4Track {
  return {
    id: 1,
    kind: 'video',
    format: { codec: 'avc1.64001f', timescale: 90_000, width: 640, height: 480 },
    samples: samples(count),
  }
}

describe('drainSamples', () => {
  it('hands every sample over, in order', () => {
    const track = videoTrackOf(5)
    const original = [...track.samples]

    expect([...drainSamples(track).samples]).toEqual(original)
  })

  it('reports how many there were, before any of them are given up', () => {
    expect(drainSamples(videoTrackOf(7)).total).toBe(7)
  })

  it('empties the track, so nothing downstream can hold the whole list through it', () => {
    const track = videoTrackOf(5)

    drainSamples(track)

    expect(track.samples).toEqual([])
  })

  it('releases each sample as it is handed over, not at the end', () => {
    // The point of the module. A transcode reads the encoded source and writes
    // encoded output, and both are live at once unless the source is let go of
    // sample by sample — which is the difference between `MEMORY.webcodecs`
    // holding four copies of the file and holding five.
    const track = videoTrackOf(4)
    const stream = drainSamples(track)
    const held: number[] = []
    const seen: Mp4Sample[] = []

    for (const sample of stream.samples) {
      seen.push(sample)
      held.push(stream.remaining)
    }

    expect(seen).toHaveLength(4)
    expect(held).toEqual([3, 2, 1, 0])
  })

  it('never yields the same sample twice, even if the stream is read again', () => {
    const stream = drainSamples(videoTrackOf(3))

    expect([...stream.samples]).toHaveLength(3)
    expect([...stream.samples]).toHaveLength(0)
  })

  it('answers an empty track with nothing, rather than throwing', () => {
    const track = videoTrackOf(0)
    const stream = drainSamples(track)

    expect(stream.total).toBe(0)
    expect([...stream.samples]).toEqual([])
  })
})

describe('keepOnlyTrack', () => {
  const media = (): Mp4Media => ({
    tracks: [
      videoTrackOf(3),
      {
        id: 2,
        kind: 'audio',
        format: { codec: 'mp4a.40.2', timescale: 44_100, channelCount: 2, sampleRate: 44_100 },
        samples: samples(4, 512),
      },
    ],
  })

  it('leaves the one track the job will read', () => {
    const file = media()
    const [video] = file.tracks

    keepOnlyTrack(file, video)

    expect(file.tracks).toEqual([video])
  })

  it('empties the tracks it drops, so their samples are not reachable through the caller', () => {
    const file = media()
    const [video, audio] = file.tracks

    keepOnlyTrack(file, video)

    expect(audio.samples).toEqual([])
  })

  it('is a no-op when the file had one track to begin with', () => {
    const file: Mp4Media = { tracks: [videoTrackOf(2)] }
    const [only] = file.tracks

    keepOnlyTrack(file, only)

    expect(file.tracks).toEqual([only])
    expect(only.samples).toHaveLength(2)
  })
})

describe('keepOnlyTracks', () => {
  const media = (): Mp4Media => ({
    tracks: [
      videoTrackOf(3),
      {
        id: 2,
        kind: 'audio',
        format: { codec: 'mp4a.40.2', timescale: 44_100, channelCount: 2, sampleRate: 44_100 },
        samples: samples(4, 512),
      },
      {
        id: 3,
        kind: 'audio',
        format: { codec: 'mp4a.40.2', timescale: 48_000, channelCount: 1, sampleRate: 48_000 },
        samples: samples(5, 512),
      },
    ],
  })

  it('leaves every track the job will read, in the order it was given them', () => {
    const file = media()
    const [video, first] = file.tracks

    keepOnlyTracks(file, [video, first])

    expect(file.tracks).toEqual([video, first])
  })

  it('keeps the samples of the tracks it was told to keep', () => {
    // A video transcode drains its own track; the audio track it carries is
    // copied sample for sample into the muxer, so emptying it would ship a
    // soundtrack of nothing.
    const file = media()
    const [video, sound] = file.tracks

    keepOnlyTracks(file, [video, sound])

    expect(video.samples).toHaveLength(3)
    expect(sound.samples).toHaveLength(4)
  })

  it('empties every track it drops, so their samples are not reachable through the caller', () => {
    const file = media()
    const [video, kept, dropped] = file.tracks

    keepOnlyTracks(file, [video, kept])

    expect(dropped.samples).toEqual([])
  })

  it('drops everything when the list is empty', () => {
    const file = media()
    const [video] = file.tracks

    keepOnlyTracks(file, [])

    expect(file.tracks).toEqual([])
    expect(video.samples).toEqual([])
  })
})
