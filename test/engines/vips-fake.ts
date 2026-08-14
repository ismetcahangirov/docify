/**
 * A stand-in for wasm-vips.
 *
 * The real module is 5 MB of Emscripten output that needs a cross-origin
 * isolated document, `SharedArrayBuffer` and a WASM runtime — none of which a
 * unit test has. `lib/engines/vips-runtime.ts` declares the handful of methods
 * the engine actually calls, so this file satisfies that interface instead and
 * the engine's own logic — format tables, resize path, progress, cancellation,
 * handle cleanup — is testable headlessly.
 *
 * Test-support code, not shipped.
 */

import type { VipsImage, VipsLoader, VipsModule } from '@/lib/engines/vips-runtime'

export type OpenCall =
  | { kind: 'newFromBuffer'; bytes: Uint8Array; options?: Record<string, unknown> }
  | {
      kind: 'thumbnailBuffer'
      bytes: Uint8Array
      width: number
      options?: Record<string, unknown>
    }

export interface WriteCall {
  suffix: string
  options?: Record<string, unknown>
}

class FakeImage implements VipsImage {
  readonly width = 1200
  readonly height = 800
  kill = false
  deleted = false
  onProgress: (percent: number) => void = () => {}

  constructor(private readonly fake: FakeVips) {}

  writeToBuffer(suffix: string, options?: Record<string, unknown>): Uint8Array {
    this.fake.writes.push({ suffix, options })
    this.fake.duringWrite?.(this)

    return new Uint8Array([1, 2, 3, 4])
  }

  delete(): void {
    this.deleted = true
  }
}

export interface FakeVips {
  /** One entry per `loadVips` call, holding the side modules it was asked for. */
  loads: string[][]
  opens: OpenCall[]
  writes: WriteCall[]
  images: FakeImage[]
  shutdowns: number
  /** Runs inside `writeToBuffer`, where libvips would be evaluating pixels. */
  duringWrite?: (image: FakeImage) => void
  load: VipsLoader
}

/**
 * Builds a fake module together with the loader that hands it out.
 *
 * The loader is the injection point `createRunner` takes, so a test never has to
 * stub a module registry or a network call.
 */
export function fakeVips(): FakeVips {
  const fake: FakeVips = {
    loads: [],
    opens: [],
    writes: [],
    images: [],
    shutdowns: 0,
    load: async () => {
      throw new Error('replaced below')
    },
  }

  const newImage = (): FakeImage => {
    const image = new FakeImage(fake)
    fake.images.push(image)
    return image
  }

  const vips: VipsModule = {
    Image: {
      newFromBuffer(bytes, _stringOptions, options) {
        fake.opens.push({ kind: 'newFromBuffer', bytes, options })
        return newImage()
      },
      thumbnailBuffer(bytes, width, options) {
        fake.opens.push({ kind: 'thumbnailBuffer', bytes, width, options })
        return newImage()
      },
    },
    shutdown() {
      fake.shutdowns += 1
    },
  }

  fake.load = async (dynamicLibraries) => {
    fake.loads.push([...dynamicLibraries])
    return vips
  }

  return fake
}
