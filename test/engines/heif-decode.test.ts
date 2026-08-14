// @vitest-environment node
//
// The decode half of the HEIC engine, tested on both sides of the WASM
// boundary.
//
// The first suite drives `decodeHeif` with a fake libheif module, because the
// behaviour worth pinning there is bookkeeping the real library cannot be asked
// about: which of several images in a burst is picked, and whether every one of
// them is released afterwards. The second suite loads the real WASM build and
// decodes a real file, because a fake proves only that the glue is
// self-consistent.
//
// `test/fixtures/colors-64.heic` is `fuzzing/data/corpus/colors-no-alpha.heic`
// from the libheif project (strukturag/libheif, LGPL-3.0): a synthetic 64x64
// colour ramp, 499 bytes, small enough to read as source and large enough to
// have a real HEVC tile in it.

import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it, vi } from 'vitest'

import {
  decodeHeif,
  type HeifDecoder,
  type HeifImage,
  type HeifModule,
  loadHeif,
} from '@/lib/engines/heif-decode'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const fixture = new Uint8Array(readFileSync(join(repoRoot, 'test/fixtures/colors-64.heic')))

/** A libheif image that hands back a solid colour, and records its own release. */
function fakeImage(options: {
  width?: number
  height?: number
  primary?: boolean
  fill?: number
  fails?: boolean
  freed?: string[]
  name?: string
}): HeifImage {
  const { width = 2, height = 2, primary = false, fill = 1, fails = false } = options

  return {
    get_width: () => width,
    get_height: () => height,
    is_primary: () => primary,
    display(target, done) {
      if (fails) {
        done(null)
        return
      }
      target.data.fill(fill)
      done(target)
    },
    free() {
      options.freed?.push(options.name ?? 'image')
    },
  }
}

function fakeModule(images: HeifImage[], onDecode?: (data: Uint8Array) => void): HeifModule {
  return {
    HeifDecoder: class implements HeifDecoder {
      decode(data: Uint8Array): HeifImage[] {
        onDecode?.(data)
        return images
      }
    },
  }
}

describe('decodeHeif, against a fake libheif', () => {
  it('returns a bitmap sized from the image, with four bytes per pixel', async () => {
    const bitmap = await decodeHeif(
      fakeModule([fakeImage({ width: 5, height: 3, fill: 9 })]),
      fixture,
    )

    expect(bitmap.width).toBe(5)
    expect(bitmap.height).toBe(3)
    expect(bitmap.data.length).toBe(5 * 3 * 4)
    expect([...new Set(bitmap.data)]).toEqual([9])
  })

  it('hands the file straight to the decoder', async () => {
    const seen = vi.fn()

    await decodeHeif(fakeModule([fakeImage({})], seen), fixture)

    expect(seen).toHaveBeenCalledWith(fixture)
  })

  it('decodes the primary image, not merely the first one', async () => {
    // A burst or a Live Photo carries several images; the one the user sees in
    // their gallery is the one flagged primary, which need not be index zero.
    const images = [
      fakeImage({ fill: 1 }),
      fakeImage({ fill: 2, primary: true }),
      fakeImage({ fill: 3 }),
    ]

    const bitmap = await decodeHeif(fakeModule(images), fixture)

    expect([...new Set(bitmap.data)]).toEqual([2])
  })

  it('falls back to the first image when the file flags no primary', async () => {
    const bitmap = await decodeHeif(
      fakeModule([fakeImage({ fill: 7 }), fakeImage({ fill: 8 })]),
      fixture,
    )

    expect([...new Set(bitmap.data)]).toEqual([7])
  })

  it('falls back to the first image when libheif cannot answer which is primary', async () => {
    // libheif-js 1.19.8 ships `is_primary()` calling a bare
    // `heif_image_handle_is_primary_image(...)`, where every sibling method goes
    // through the module object. The identifier resolves to nothing, so the call
    // throws for every image in every file — which is why a throw cannot be read
    // as "this one is not primary" and has to end the search instead.
    const unanswerable = (fill: number): HeifImage => ({
      ...fakeImage({ fill }),
      is_primary(): boolean {
        throw new ReferenceError('heif_image_handle_is_primary_image is not defined')
      },
    })

    const bitmap = await decodeHeif(fakeModule([unanswerable(5), unanswerable(6)]), fixture)

    expect([...new Set(bitmap.data)]).toEqual([5])
  })

  it('releases every image in the file, not just the one it used', async () => {
    // Each undecoded image still holds a WASM-side handle. Leaking the ones a
    // burst did not need is how a tab dies on the fifth conversion.
    const freed: string[] = []
    const images = [
      fakeImage({ freed, name: 'a' }),
      fakeImage({ freed, name: 'b', primary: true }),
      fakeImage({ freed, name: 'c' }),
    ]

    await decodeHeif(fakeModule(images), fixture)

    expect(freed.sort()).toEqual(['a', 'b', 'c'])
  })

  it('releases every image even when the decode fails', async () => {
    const freed: string[] = []
    const images = [fakeImage({ freed, name: 'a', fails: true }), fakeImage({ freed, name: 'b' })]

    await expect(decodeHeif(fakeModule(images), fixture)).rejects.toThrow()
    expect(freed.sort()).toEqual(['a', 'b'])
  })

  it('explains an empty result rather than returning an empty bitmap', async () => {
    // libheif answers a file it cannot parse with an empty array and no throw.
    await expect(decodeHeif(fakeModule([]), fixture)).rejects.toThrow(/no image/i)
  })

  it('explains a failed render, which libheif signals with a null callback', async () => {
    await expect(decodeHeif(fakeModule([fakeImage({ fails: true })]), fixture)).rejects.toThrow(
      /could not be decoded/i,
    )
  })

  it('refuses an image with no pixels rather than allocating a zero-length buffer', async () => {
    await expect(
      decodeHeif(fakeModule([fakeImage({ width: 0, height: 4 })]), fixture),
    ).rejects.toThrow(/dimensions/i)
  })
})

describe('decodeHeif, against the real libheif build', () => {
  it('decodes a real HEIC file to the pixels the reference decoder produces', async () => {
    const bitmap = await decodeHeif(await loadHeif(), fixture)

    expect([bitmap.width, bitmap.height]).toEqual([64, 64])
    expect(bitmap.data.length).toBe(64 * 64 * 4)
    // Byte-exact against libheif's own output for this file: a top-left teal
    // and a bottom-right red, both fully opaque.
    expect([...bitmap.data.slice(0, 4)]).toEqual([5, 151, 132, 255])
    expect([...bitmap.data.slice(-4)]).toEqual([253, 0, 0, 255])
  })

  it('rejects bytes that are not a HEIF file at all', async () => {
    const notHeif = new TextEncoder().encode('this is plainly not a HEIF file')

    await expect(decodeHeif(await loadHeif(), notHeif)).rejects.toThrow(/no image/i)
  })

  it('loads the WASM module once and hands the same instance back', async () => {
    // Instantiating libheif costs a megabyte of heap. A second conversion in the
    // same worker must reuse the warm module rather than allocate another.
    expect(await loadHeif()).toBe(await loadHeif())
  })
})
