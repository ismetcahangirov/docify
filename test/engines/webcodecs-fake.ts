/**
 * A stand-in for the WebCodecs video API.
 *
 * `VideoEncoder` and `VideoDecoder` exist in no test environment and cannot be
 * constructed without a real codec behind them, so `lib/engines/webcodecs-runtime.ts`
 * declares the handful of members the pipeline actually calls and this file
 * satisfies that instead. What is then testable is the *choreography* — the
 * order of configure, decode, encode and flush, the backpressure, what gets
 * closed, and what happens when a codec reports an error mid-job — which is the
 * part that has bugs.
 *
 * The fake codecs are deliberately synchronous-ish: each `decode` produces a
 * frame on a microtask and each `encode` a chunk on the next, so a test observes
 * the same interleaving a real codec produces without waiting for one.
 *
 * Test-support code, not shipped.
 */

import type {
  ConfigSupport,
  DecoderConfig,
  EncodedChunkInit,
  EncodedChunkLike,
  EncodedChunkMetadata,
  EncoderConfig,
  VideoCodecs,
  VideoDecoderLike,
  VideoEncoderLike,
  VideoFrameLike,
} from '@/lib/engines/webcodecs-runtime'

/** A chunk that is nothing but its bytes and its timing. */
export class FakeChunk implements EncodedChunkLike {
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

/** A frame that records whether anyone released it. */
export class FakeFrame implements VideoFrameLike {
  closed = 0

  constructor(
    readonly timestamp: number,
    readonly duration: number | null,
    readonly from: EncodedChunkLike,
  ) {}

  close(): void {
    this.closed += 1
  }
}

export interface FakeVideoCodecs extends VideoCodecs {
  /** Every configuration `isConfigSupported` was asked about, in order. */
  asked: EncoderConfig[]
  /** The configuration the encoder was actually given. */
  encoderConfig: EncoderConfig | null
  /** The configuration the decoder was given. */
  decoderConfig: DecoderConfig | null
  /** Every chunk handed to the decoder. */
  decoded: EncodedChunkLike[]
  /** Every frame handed to the encoder. */
  encoded: FakeFrame[]
  closes: { decoder: number; encoder: number }
  /** Codec strings `isConfigSupported` says yes to. Everything else is refused. */
  accept: (codec: string) => boolean
  /** Runs after each decode, so a test can fail a codec part way through. */
  duringDecode?: (index: number, fail: (reason: Error) => void) => void
  /** The `avcC` record the encoder reports with its first chunk. */
  configurationRecord: Uint8Array | null
}

/**
 * Builds a fake platform whose encoder answers one chunk per frame.
 *
 * The chunk carries the frame's own timing and a one-byte payload derived from
 * it, so a test can assert that a particular sample came out the far end.
 */
export function fakeVideoCodecs(): FakeVideoCodecs {
  const fake: FakeVideoCodecs = {
    asked: [],
    encoderConfig: null,
    decoderConfig: null,
    decoded: [],
    encoded: [],
    closes: { decoder: 0, encoder: 0 },
    accept: () => true,
    // A real AVC decoder configuration record: a container parses this on the
    // way back in, so a plausible-looking stub would come out re-serialised to
    // something else and the round-trip assertion would be about nothing.
    configurationRecord: new Uint8Array([
      1, 0x64, 0, 0x1f, 0xff, 0xe1, 0, 4, 0x67, 0x64, 0, 0x1f, 1, 0, 4, 0x68, 0xee, 0x3c, 0xb0,
    ]),

    async isEncoderConfigSupported(config: EncoderConfig): Promise<ConfigSupport> {
      fake.asked.push(config)

      return { supported: fake.accept(config.codec), config }
    },

    async isDecoderConfigSupported() {
      return { supported: true }
    },

    createDecoder(init): VideoDecoderLike {
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
            init.output(new FakeFrame(chunk.timestamp, chunk.duration, chunk))
          })
        },
        async flush() {
          // Two turns: one for the decode microtasks, one for the encodes they
          // start. A real flush drains both queues too.
          await Promise.resolve()
          await Promise.resolve()
        },
        close() {
          fake.closes.decoder += 1
        },
      }
    },

    createEncoder(init): VideoEncoderLike {
      let queue = 0
      let first = true

      return {
        get encodeQueueSize() {
          return queue
        },
        configure(config) {
          fake.encoderConfig = config
        },
        encode(frame) {
          const index = fake.encoded.length
          fake.encoded.push(frame as FakeFrame)
          queue += 1

          void Promise.resolve().then(() => {
            queue -= 1
            const metadata: EncodedChunkMetadata =
              first && fake.configurationRecord !== null
                ? { decoderConfig: { description: fake.configurationRecord } }
                : {}
            first = false

            init.output(
              new FakeChunk(
                index === 0 ? 'key' : 'delta',
                frame.timestamp,
                frame.duration,
                new Uint8Array([index + 1, index + 1]),
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

    encodedChunk(init: EncodedChunkInit): EncodedChunkLike {
      return new FakeChunk(init.type, init.timestamp, init.duration, init.data)
    },
  }

  return fake
}
