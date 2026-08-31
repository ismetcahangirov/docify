/**
 * The half of mp4box.js this project calls, declared structurally.
 *
 * Same reasoning as `./vips-runtime` and `./pdfjs-runtime`: a hand-written
 * interface this small can be satisfied by a fake, which is what lets the demux
 * and mux layers be driven without the library — and the library's own typings
 * describe far more of ISO/IEC 14496-12 than anything here touches.
 *
 * ## Why a box can be a bag of bytes
 *
 * mp4box writes a sample entry's children by calling `write(stream)` on each of
 * them and sizing the parent from their `size`. Nothing else about a box is
 * consulted. {@link rawBox} exploits that: a codec configuration is carried
 * across a remux as the exact bytes it arrived as, with no parser in between, so
 * an `esds` descriptor tree or an `av1C` this project has never heard of
 * survives untouched. Verified by round trip in
 * `test/engines/mp4-container.test.ts`, byte for byte.
 *
 * ## Loading
 *
 * `await import('mp4box')` and nowhere else. The library is around 120 kB, which
 * is small next to a WASM engine and far too large to sit in a page bundle for
 * the sake of a user who came to convert a PNG (CLAUDE.md §2.3).
 */

/** mp4box's own big-endian stream. Only the two members used here are named. */
export interface Mp4Stream {
  /** The bytes written so far, trimmed to length. */
  readonly buffer: ArrayBuffer
  writeUint8Array(bytes: Uint8Array): void
}

/** Anything mp4box will write into a sample entry. */
export interface Mp4Box {
  type: string
  /** The box's *total* length in bytes, header included. */
  size: number
  write(stream: Mp4Stream): void
  computeSize?(): void
}

/** One track as mp4box describes it after parsing the `moov`. */
export interface Mp4TrackInfo {
  id: number
  codec: string
  timescale: number
  language?: string
  nb_samples: number
  video?: { width: number; height: number }
  audio?: { sample_rate: number; channel_count: number }
}

export interface Mp4Info {
  tracks: readonly Mp4TrackInfo[]
}

/** One sample as mp4box delivers it. Field names are the library's. */
export interface Mp4RawSample {
  data: Uint8Array
  dts: number
  cts: number
  duration: number
  is_sync: boolean
}

/** The sample-description entry a track's codec configuration hangs off. */
export interface Mp4SampleEntry {
  type: string
  boxes: readonly Mp4Box[]
}

export interface Mp4Trak {
  mdia: { minf: { stbl: { stsd: { entries: readonly Mp4SampleEntry[] } } } }
}

/** What `addTrack` is given. A subset of mp4box's `IsoFileOptions`. */
export interface Mp4TrackOptions {
  type: string
  timescale: number
  language?: string
  width?: number
  height?: number
  channel_count?: number
  samplerate?: number
  samplesize?: number
  hdlr?: string
  name?: string
  description_boxes?: readonly Mp4Box[]
}

export interface Mp4SampleOptions {
  duration: number
  dts: number
  cts: number
  is_sync: boolean
}

export interface Mp4File {
  onReady?: (info: Mp4Info) => void
  onSamples?: (id: number, user: unknown, samples: readonly Mp4RawSample[]) => void
  onError?: (module: string, message: string) => void
  appendBuffer(buffer: ArrayBuffer): number
  flush(): void
  start(): void
  stop(): void
  setExtractionOptions(trackId: number, user: unknown, options: { nbSamples: number }): void
  getTrackById(trackId: number): Mp4Trak | undefined
  addTrack(options: Mp4TrackOptions): number
  addSample(trackId: number, data: Uint8Array, options: Mp4SampleOptions): unknown
  /**
   * The finished file — as mp4box's own stream, not as bytes.
   *
   * Its name says otherwise and its `byteLength` is the file's length, which is
   * exactly enough to make `new Uint8Array(file.getBuffer())` look right and
   * produce an empty array. {@link writtenBytes} is the way to read it.
   */
  getBuffer(): Mp4Stream
}

/** The module surface: a factory, a stream and the buffer type `appendBuffer` wants. */
export interface Mp4BoxModule {
  createFile(): Mp4File
  DataStream: new (
    buffer: ArrayBuffer | undefined,
    offset: number,
    endianness: boolean,
  ) => Mp4Stream
  MP4BoxBuffer: { fromArrayBuffer(buffer: ArrayBuffer, fileStart: number): ArrayBuffer }
}

/** How the layers obtain the library. A parameter everywhere, so tests need none. */
export type Mp4BoxLoader = () => Promise<Mp4BoxModule>

/** mp4box's `DataStream.BIG_ENDIAN`, which every box in an MP4 is written in. */
export const BIG_ENDIAN = false

/**
 * Loads mp4box.js.
 *
 * A plain `await import()` rather than the by-URL fetching `./vips-runtime` and
 * `./pdfjs-runtime` do: those exist to keep a multi-megabyte WASM binary out of
 * the bundler's sight entirely, and at 120 kB of ordinary JavaScript this is
 * exactly what a dynamic import is for. The bundler emits it as its own chunk
 * and nothing about it reaches a page.
 */
export async function loadMp4Box(): Promise<Mp4BoxModule> {
  return (await import('mp4box')) as unknown as Mp4BoxModule
}

/**
 * The finished file's bytes.
 *
 * A copy rather than a view, because mp4box's stream owns the buffer underneath
 * and will keep writing into it if the same file is used again.
 */
export function writtenBytes(file: Mp4File): Uint8Array<ArrayBuffer> {
  const written = new Uint8Array(file.getBuffer().buffer)
  const out = new Uint8Array(written.length)
  out.set(written)

  return out
}

/**
 * A box that is nothing but the bytes it was given.
 *
 * `size` is the *total* length including the four-byte length and the
 * four-character type, which is what mp4box reserves for a child of a sample
 * entry — and what it double-checks when the file is read back. Getting that
 * wrong produces a file whose sample entry is one box shorter than its contents,
 * which the parser reports as an invalid box type several bytes later.
 */
export function rawBox(bytes: Uint8Array, type: string): Mp4Box {
  return {
    type,
    size: bytes.length,
    write: (stream) => stream.writeUint8Array(bytes),
    computeSize() {
      this.size = bytes.length
    },
  }
}
