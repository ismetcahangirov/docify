/**
 * The audio half of WebCodecs, declared structurally.
 *
 * A separate module from `./webcodecs-runtime` rather than more of it: the two
 * families share nothing but a naming convention — an `AudioData` is not a
 * `VideoFrame`, an `AudioEncoderConfig` has none of the fields a video one does,
 * and `caps.webCodecsAudio` is probed apart from `caps.webCodecsVideo` because
 * a browser can genuinely have one and not the other. Keeping them apart also
 * keeps each file inside the size rule (CLAUDE.md §5.2).
 *
 * The reasoning for declaring them at all is the same: `AudioEncoder` exists in
 * no test environment, so the pipeline's ordering, backpressure and teardown are
 * only provable against a fake.
 */

/** `AudioEncoderConfig`, as much of it as this project sets. */
export interface AudioEncoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  bitrate?: number
  /** `aac` is the raw form an MP4 stores; `adts` wraps every frame in a header. */
  aac?: { format: 'aac' | 'adts' }
  opus?: { format?: 'opus' | 'ogg' }
}

/** `AudioDecoderConfig`, likewise. */
export interface AudioDecoderConfig {
  codec: string
  sampleRate: number
  numberOfChannels: number
  description?: Uint8Array
}

export interface AudioConfigSupport {
  supported?: boolean
  config?: AudioEncoderConfig
}

/** A decoded block of samples. Opaque: it goes straight from decoder to encoder. */
export interface AudioDataLike {
  readonly timestamp: number
  readonly numberOfFrames: number
  close(): void
}

export interface EncodedAudioChunkLike {
  readonly type: 'key' | 'delta'
  readonly timestamp: number
  readonly duration: number | null
  readonly byteLength: number
  copyTo(destination: Uint8Array): void
}

export interface EncodedAudioChunkMetadata {
  decoderConfig?: { description?: ArrayBuffer | ArrayBufferView }
}

export interface AudioDecoderLike {
  readonly decodeQueueSize: number
  configure(config: AudioDecoderConfig): void
  decode(chunk: EncodedAudioChunkLike): void
  flush(): Promise<void>
  close(): void
}

export interface AudioEncoderLike {
  readonly encodeQueueSize: number
  configure(config: AudioEncoderConfig): void
  encode(data: AudioDataLike): void
  flush(): Promise<void>
  close(): void
}

export interface EncodedAudioChunkInit {
  type: 'key' | 'delta'
  timestamp: number
  duration: number
  data: Uint8Array
}

/** The platform entry points the audio path needs, in one injectable object. */
export interface AudioCodecs {
  /** `AudioEncoder.isConfigSupported`. Never skipped — see `./audio-config`. */
  isEncoderConfigSupported(config: AudioEncoderConfig): Promise<AudioConfigSupport>
  createDecoder(init: {
    output: (data: AudioDataLike) => void
    error: (reason: Error) => void
  }): AudioDecoderLike
  createEncoder(init: {
    output: (chunk: EncodedAudioChunkLike, metadata: EncodedAudioChunkMetadata) => void
    error: (reason: Error) => void
  }): AudioEncoderLike
  encodedChunk(init: EncodedAudioChunkInit): EncodedAudioChunkLike
}

/** How the pipeline obtains the codecs. A parameter everywhere it is used. */
export type AudioCodecsLoader = () => AudioCodecs

/**
 * Binds the real platform APIs.
 *
 * Called at runner construction rather than at module load, so importing this
 * file never touches a global — the module is reachable from a chunk that is
 * evaluated during server rendering, where none of these exist.
 */
export function browserAudioCodecs(): AudioCodecs {
  if (typeof AudioEncoder === 'undefined' || typeof AudioDecoder === 'undefined') {
    throw new Error(
      'This browser does not have the audio codecs (AudioEncoder / AudioDecoder) this ' +
        'conversion needs. Chrome, Edge and Safari 16.4 or newer have them.',
    )
  }

  return {
    isEncoderConfigSupported: (config) =>
      AudioEncoder.isConfigSupported(
        config as unknown as globalThis.AudioEncoderConfig,
      ) as Promise<AudioConfigSupport>,
    createDecoder: (init) =>
      new AudioDecoder({
        output: (data) => init.output(data as unknown as AudioDataLike),
        error: init.error,
      }) as unknown as AudioDecoderLike,
    createEncoder: (init) =>
      new AudioEncoder({
        output: (chunk, metadata) =>
          init.output(
            chunk as unknown as EncodedAudioChunkLike,
            metadata as EncodedAudioChunkMetadata,
          ),
        error: init.error,
      }) as unknown as AudioEncoderLike,
    encodedChunk: (init) => new EncodedAudioChunk(init) as unknown as EncodedAudioChunkLike,
  }
}
