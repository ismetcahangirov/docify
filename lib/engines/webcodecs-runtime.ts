/**
 * The half of WebCodecs this project calls, declared structurally.
 *
 * Same reasoning as `./mp4-runtime` and the two before it: `VideoEncoder` and
 * `VideoDecoder` exist in no test environment, they cannot be constructed
 * without a real codec behind them, and a hand-written interface this small can
 * be satisfied by a fake. That is what lets the transcode pipeline — its
 * ordering, its backpressure, its teardown, its cancellation — be proved
 * headlessly, which is the same bargain `Capabilities` being a parameter buys
 * the router.
 *
 * The names are the platform's, so a reader can take any line here to the
 * specification. What is *not* the platform's is {@link VideoCodecs}: the four
 * globals arrive as one injected object rather than being reached through
 * `globalThis` at the call site.
 */

/** `VideoEncoderConfig`, as much of it as this project sets. */
export interface EncoderConfig {
  codec: string
  width: number
  height: number
  bitrate: number
  framerate?: number
  /**
   * `prefer-hardware`, `prefer-software` or `no-preference`.
   *
   * A hint the browser may ignore, which is why the answer to "did we get
   * hardware?" is never asserted — only asked for. See `./video-config`.
   */
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
  /** `avc` asks for the length-prefixed form an MP4 stores; `annexb` for the other. */
  avc?: { format: 'avc' | 'annexb' }
  latencyMode?: 'quality' | 'realtime'
}

/** `VideoDecoderConfig`, likewise. */
export interface DecoderConfig {
  codec: string
  codedWidth?: number
  codedHeight?: number
  description?: Uint8Array
  hardwareAcceleration?: 'no-preference' | 'prefer-hardware' | 'prefer-software'
}

/** What `isConfigSupported` answers. */
export interface ConfigSupport {
  supported?: boolean
  config?: EncoderConfig
}

/** A decoded frame. Opaque here: it goes straight from the decoder to the encoder. */
export interface VideoFrameLike {
  readonly timestamp: number
  readonly duration: number | null
  close(): void
}

/** One encoded frame out of the encoder, or one on its way into the decoder. */
export interface EncodedChunkLike {
  readonly type: 'key' | 'delta'
  readonly timestamp: number
  readonly duration: number | null
  readonly byteLength: number
  copyTo(destination: Uint8Array): void
}

/** What an encoder reports alongside its first chunk. */
export interface EncodedChunkMetadata {
  decoderConfig?: { description?: ArrayBuffer | ArrayBufferView }
}

export interface VideoDecoderLike {
  readonly decodeQueueSize: number
  configure(config: DecoderConfig): void
  decode(chunk: EncodedChunkLike): void
  flush(): Promise<void>
  close(): void
}

export interface VideoEncoderLike {
  readonly encodeQueueSize: number
  configure(config: EncoderConfig): void
  encode(frame: VideoFrameLike, options?: { keyFrame?: boolean }): void
  flush(): Promise<void>
  close(): void
}

/** What an `EncodedVideoChunk` is built from on its way into a decoder. */
export interface EncodedChunkInit {
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  data: Uint8Array
}

/**
 * The four platform entry points the video path needs, in one object.
 *
 * Injected rather than read off `globalThis`, so the pipeline can be driven by
 * `test/engines/webcodecs-fake.ts` with no browser and no codec.
 */
export interface VideoCodecs {
  /** `VideoEncoder.isConfigSupported`. Never skipped — see `./video-config`. */
  isEncoderConfigSupported(config: EncoderConfig): Promise<ConfigSupport>
  /** `VideoDecoder.isConfigSupported`. */
  isDecoderConfigSupported(config: DecoderConfig): Promise<{ supported?: boolean }>
  createDecoder(init: {
    output: (frame: VideoFrameLike) => void
    error: (reason: Error) => void
  }): VideoDecoderLike
  createEncoder(init: {
    output: (chunk: EncodedChunkLike, metadata: EncodedChunkMetadata) => void
    error: (reason: Error) => void
  }): VideoEncoderLike
  encodedChunk(init: EncodedChunkInit): EncodedChunkLike
}

/** How the pipeline obtains the codecs. A parameter everywhere it is used. */
export type VideoCodecsLoader = () => VideoCodecs

/**
 * Binds the real platform APIs.
 *
 * Called at runner construction rather than at module load, so importing this
 * file never touches a global — which matters because the module is reachable
 * from the engine descriptor's chunk and that chunk is evaluated during server
 * rendering, where none of these exist.
 */
export function browserVideoCodecs(): VideoCodecs {
  assertAvailable()

  return {
    isEncoderConfigSupported: (config) =>
      VideoEncoder.isConfigSupported(
        config as unknown as VideoEncoderConfig,
      ) as Promise<ConfigSupport>,
    isDecoderConfigSupported: (config) =>
      VideoDecoder.isConfigSupported(config as unknown as VideoDecoderConfig),
    createDecoder: (init) =>
      new VideoDecoder({
        output: (frame) => init.output(frame as unknown as VideoFrameLike),
        error: init.error,
      }) as unknown as VideoDecoderLike,
    createEncoder: (init) =>
      new VideoEncoder({
        output: (chunk, metadata) =>
          init.output(chunk as unknown as EncodedChunkLike, metadata as EncodedChunkMetadata),
        error: init.error,
      }) as unknown as VideoEncoderLike,
    encodedChunk: (init) => new EncodedVideoChunk(init) as unknown as EncodedChunkLike,
  }
}

/**
 * Refuses early, and by name, on a browser without the codecs.
 *
 * `route()` gates on `caps.webCodecsVideo` and should never send a job here
 * without them, so reaching this is a routing bug — but a `ReferenceError:
 * VideoEncoder is not defined` several seconds into a conversion is a much worse
 * way to find out than a sentence.
 */
function assertAvailable(): void {
  if (typeof VideoEncoder === 'undefined' || typeof VideoDecoder === 'undefined') {
    throw new Error(
      'This browser does not have the video codecs (VideoEncoder / VideoDecoder) this ' +
        'conversion needs. Chrome, Edge and Safari 16.4 or newer have them.',
    )
  }
}
