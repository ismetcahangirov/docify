/**
 * A stand-in for the WebCodecs audio API.
 *
 * The counterpart to `./webcodecs-fake`, and for the same reason: `AudioEncoder`
 * exists in no test environment, so the choreography — configure, decode,
 * encode, flush, teardown, cancellation — is only provable against something
 * that behaves like one.
 *
 * Test-support code, not shipped.
 */

import type {
  AudioCodecs,
  AudioConfigSupport,
  AudioDataLike,
  AudioDecoderConfig,
  AudioDecoderLike,
  AudioEncoderConfig,
  AudioEncoderLike,
  EncodedAudioChunkInit,
  EncodedAudioChunkLike,
  EncodedAudioChunkMetadata,
} from '@/lib/engines/webcodecs-audio-runtime'

export class FakeAudioChunk implements EncodedAudioChunkLike {
  constructor(
    readonly type: 'key' | 'delta',
    readonly timestamp: number,
    readonly duration: number | null,
    private readonly bytes: Uint8Array,
  ) {}

  get byteLength(): number {
    return this.bytes.length
  }

  copyTo(destination: Uint8Array): void {
    destination.set(this.bytes)
  }
}

export class FakeAudioData implements AudioDataLike {
  closed = 0

  constructor(
    readonly timestamp: number,
    readonly numberOfFrames: number,
    readonly duration: number,
  ) {}

  close(): void {
    this.closed += 1
  }
}

export interface FakeAudioCodecs extends AudioCodecs {
  asked: AudioEncoderConfig[]
  encoderConfig: AudioEncoderConfig | null
  decoderConfig: AudioDecoderConfig | null
  decoded: EncodedAudioChunkLike[]
  encoded: FakeAudioData[]
  closes: { decoder: number; encoder: number }
  /** Codec strings `isConfigSupported` says yes to. */
  accept: (codec: string) => boolean
  /** Runs after each decode, so a test can fail a codec part way through. */
  duringDecode?: (index: number, fail: (reason: Error) => void) => void
  /** What the encoder reports as its configuration alongside the first packet. */
  configurationRecord: Uint8Array | null
}

/** Builds a fake platform whose encoder answers one packet per decoded block. */
export function fakeAudioCodecs(): FakeAudioCodecs {
  const fake: FakeAudioCodecs = {
    asked: [],
    encoderConfig: null,
    decoderConfig: null,
    decoded: [],
    encoded: [],
    closes: { decoder: 0, encoder: 0 },
    accept: () => true,
    // An AudioSpecificConfig for AAC-LC at 44.1 kHz stereo, which is what a real
    // encoder reports and what has to end up inside the file's `esds`.
    configurationRecord: new Uint8Array([0x12, 0x10]),

    async isEncoderConfigSupported(config: AudioEncoderConfig): Promise<AudioConfigSupport> {
      fake.asked.push(config)

      return { supported: fake.accept(config.codec), config }
    },

    createDecoder(init): AudioDecoderLike {
      let queue = 0

      return {
        get decodeQueueSize() {
          return queue
        },
        configure(config) {
          fake.decoderConfig = config
        },
        decode(chunk) {
          const index = fake.decoded.length
          fake.decoded.push(chunk)
          queue += 1

          void Promise.resolve().then(() => {
            queue -= 1
            fake.duringDecode?.(index, init.error)
            init.output(new FakeAudioData(chunk.timestamp, 1024, chunk.duration ?? 0))
          })
        },
        async flush() {
          await Promise.resolve()
          await Promise.resolve()
        },
        close() {
          fake.closes.decoder += 1
        },
      }
    },

    createEncoder(init): AudioEncoderLike {
      let queue = 0
      let first = true

      return {
        get encodeQueueSize() {
          return queue
        },
        configure(config) {
          fake.encoderConfig = config
        },
        encode(data) {
          const index = fake.encoded.length
          fake.encoded.push(data as FakeAudioData)
          queue += 1

          void Promise.resolve().then(() => {
            queue -= 1
            const metadata: EncodedAudioChunkMetadata =
              first && fake.configurationRecord !== null
                ? { decoderConfig: { description: fake.configurationRecord } }
                : {}
            first = false

            init.output(
              new FakeAudioChunk(
                'key',
                data.timestamp,
                (data as FakeAudioData).duration,
                new Uint8Array(24).fill(index + 1),
              ),
              metadata,
            )
          })
        },
        async flush() {
          await Promise.resolve()
          await Promise.resolve()
        },
        close() {
          fake.closes.encoder += 1
        },
      }
    },

    encodedChunk(init: EncodedAudioChunkInit): EncodedAudioChunkLike {
      return new FakeAudioChunk(init.type, init.timestamp, init.duration, init.data)
    },
  }

  return fake
}
