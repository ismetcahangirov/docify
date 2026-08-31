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

/** One geometry operation, in the order the pipeline applied it. */
export type StageCall =
  | { kind: 'extractArea'; left: number; top: number; width: number; height: number }
  | { kind: 'resize'; scale: number; options?: Record<string, unknown> }
  | { kind: 'rot'; angle: string }
  | { kind: 'flip'; direction: string }

class FakeImage implements VipsImage {
  kill = false
  deleted = false
  onProgress: (percent: number) => void = () => {}

  constructor(
    private readonly fake: FakeVips,
    readonly width: number,
    readonly height: number,
  ) {}

  extractArea(left: number, top: number, width: number, height: number): VipsImage {
    this.fake.stages.push({ kind: 'extractArea', left, top, width, height })
    return this.fake.derive(width, height)
  }

  resize(scale: number, options?: Record<string, unknown>): VipsImage {
    this.fake.stages.push({ kind: 'resize', scale, options })
    const vscale = typeof options?.vscale === 'number' ? options.vscale : scale
    return this.fake.derive(Math.round(this.width * scale), Math.round(this.height * vscale))
  }

  rot(angle: string): VipsImage {
    this.fake.stages.push({ kind: 'rot', angle })
    const quarter = angle === 'd90' || angle === 'd270'
    return this.fake.derive(quarter ? this.height : this.width, quarter ? this.width : this.height)
  }

  flip(direction: string): VipsImage {
    this.fake.stages.push({ kind: 'flip', direction })
    return this.fake.derive(this.width, this.height)
  }

  writeToBuffer(suffix: string, options?: Record<string, unknown>): Uint8Array {
    this.fake.writes.push({ suffix, options })
    this.fake.duringWrite?.(this)

    const size = this.fake.bytesForQuality?.(options?.Q as number | undefined)

    return new Uint8Array(size ?? 4).fill(1)
  }

  delete(): void {
    this.deleted = true
  }
}

export interface FakeVips {
  /** One entry per `loadVips` call, holding the side modules it was asked for. */
  loads: string[][]
  opens: OpenCall[]
  /** Geometry operations, across every image, in the order they were applied. */
  stages: StageCall[]
  writes: WriteCall[]
  images: FakeImage[]
  shutdowns: number
  /** The dimensions every opened source reports. */
  size: { width: number; height: number }
  /** Makes the image a libvips operation would have returned. Test-internal. */
  derive: (width: number, height: number) => FakeImage
  /** Runs inside `writeToBuffer`, where libvips would be evaluating pixels. */
  duringWrite?: (image: FakeImage) => void
  /**
   * How many bytes `writeToBuffer` should hand back for a given `Q`.
   *
   * The one thing a target-size search reads, and the only way to drive it
   * without a codec: the search is a function of the sizes it observes, so a
   * fake that answers by quality reproduces the whole loop deterministically.
   * Absent means every write is four bytes, as it was before the search existed.
   */
  bytesForQuality?: (quality: number | undefined) => number
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
    stages: [],
    writes: [],
    images: [],
    shutdowns: 0,
    size: { width: 1200, height: 800 },
    derive: () => {
      throw new Error('replaced below')
    },
    load: async () => {
      throw new Error('replaced below')
    },
  }

  const newImage = (width = fake.size.width, height = fake.size.height): FakeImage => {
    const image = new FakeImage(fake, width, height)
    fake.images.push(image)
    return image
  }

  fake.derive = newImage

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
