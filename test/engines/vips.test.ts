import { describe, expect, it, vi } from 'vitest'

import { createRunner, descriptor } from '@/lib/engines/vips'
import { VIPS_BASE_LOAD_COST, VIPS_HEIF_WASM } from '@/lib/engines/vips-runtime'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

import { fakeVips } from './vips-fake'

const isolated: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const task = (from: FormatId, to: FormatId, op: Operation = 'convert'): ConversionTask => ({
  from,
  to,
  op,
})

const file = (bytes = [0, 1, 2]) => new Blob([new Uint8Array(bytes)])

/** The `size` mode of every thumbnail open, ignoring the header probes. */
const thumbnailSizes = (fake: ReturnType<typeof fakeVips>) =>
  fake.opens.filter((open) => open.kind === 'thumbnailBuffer').map((open) => open.options?.size)

describe('the vips descriptor', () => {
  it('sits at priority 40, behind Canvas and ahead of ffmpeg', () => {
    expect(descriptor.id).toBe('vips')
    expect(descriptor.priority).toBe(40)
  })

  it('quotes the base download, not the AVIF-only side module', () => {
    expect(descriptor.loadCost).toBe(VIPS_BASE_LOAD_COST)
  })

  it('claims the pairs the issue asks for: AVIF, TIFF and GIF', () => {
    expect(descriptor.supports(task('avif', 'jpg'), isolated)).toBe(true)
    expect(descriptor.supports(task('jpg', 'avif'), isolated)).toBe(true)
    expect(descriptor.supports(task('tiff', 'png'), isolated)).toBe(true)
    expect(descriptor.supports(task('png', 'tiff'), isolated)).toBe(true)
    expect(descriptor.supports(task('gif', 'webp'), isolated)).toBe(true)
    expect(descriptor.supports(task('png', 'gif'), isolated)).toBe(true)
  })

  it('reads HEIC but never writes it, because the build ships no HEVC encoder', () => {
    expect(descriptor.supports(task('heic', 'jpg'), isolated)).toBe(true)
    expect(descriptor.supports(task('jpg', 'heic'), isolated)).toBe(false)
  })

  it('claims the high-quality resize path, which is why it outranks Canvas on detail', () => {
    expect(descriptor.supports(task('jpg', 'jpg', 'resize'), isolated)).toBe(true)
    expect(descriptor.supports(task('png', 'png', 'compress'), isolated)).toBe(true)
  })

  it('claims the rest of the geometry family too', () => {
    expect(descriptor.supports(task('jpg', 'jpg', 'crop'), isolated)).toBe(true)
    expect(descriptor.supports(task('jpg', 'jpg', 'rotate'), isolated)).toBe(true)
    expect(descriptor.supports(task('png', 'png', 'flip'), isolated)).toBe(true)
  })

  it('refuses formats the vendored build has no loader for', () => {
    // BMP and ICO need ImageMagick; SVG needs the resvg side module, which is
    // not vendored because Canvas renders SVG natively and for free.
    expect(descriptor.supports(task('bmp', 'png'), isolated)).toBe(false)
    expect(descriptor.supports(task('png', 'ico'), isolated)).toBe(false)
    expect(descriptor.supports(task('svg', 'png'), isolated)).toBe(false)
    expect(descriptor.supports(task('pdf', 'png'), isolated)).toBe(false)
    expect(descriptor.supports(task('mp4', 'gif'), isolated)).toBe(false)
  })

  it('refuses operations it does not implement', () => {
    // The document family belongs to the PDF engines; claiming it here would
    // route work to a runner that ignores half of it.
    expect(descriptor.supports(task('png', 'png', 'merge'), isolated)).toBe(false)
    expect(descriptor.supports(task('png', 'png', 'split'), isolated)).toBe(false)
    expect(descriptor.supports(task('png', 'png', 'protect'), isolated)).toBe(false)
  })

  it('stands down on a document that is not cross-origin isolated', () => {
    // The vendored build is compiled with pthreads, so its WebAssembly memory is
    // `shared` and instantiating it needs SharedArrayBuffer. COOP/COEP are sent
    // on /convert/* and /tools/* only, and isolation belongs to the document —
    // so this is a live case, not a theoretical one. The router must route
    // elsewhere rather than let the engine die inside WebAssembly.Memory.
    expect(
      descriptor.supports(task('tiff', 'png'), { ...isolated, crossOriginIsolated: false }),
    ).toBe(false)
  })

  it('stands down without WASM SIMD', () => {
    expect(descriptor.supports(task('tiff', 'png'), { ...isolated, wasmSimd: false })).toBe(false)
  })

  it('decides from the task and the capabilities alone', () => {
    const before = task('tiff', 'png')
    const caps = { ...isolated }

    descriptor.supports(before, caps)

    expect(before).toEqual(task('tiff', 'png'))
    expect(caps).toEqual(isolated)
  })
})

describe('the vips runner', () => {
  it('encodes to the target format and labels the blob with its mime type', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)

    const out = await runner.run(
      { task: task('tiff', 'png'), files: [file()] },
      new AbortController().signal,
      () => {},
    )

    expect(fake.writes).toEqual([{ suffix: '.png', options: { keep: 'none', compression: 6 } }])
    expect(out.type).toBe('image/png')
    expect(out.size).toBe(4)
  })

  it('streams the source when no resize was asked for', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      { task: task('gif', 'webp'), files: [file()] },
      new AbortController().signal,
      () => {},
    )

    expect(fake.opens.at(-1)).toMatchObject({
      kind: 'newFromBuffer',
      options: { access: 'sequential' },
    })
  })

  it('resizes through libvips thumbnail, which shrinks on load and reduces with Lanczos-3', async () => {
    // This is the acceptance criterion "preserves detail better than Canvas":
    // `drawImage` downsamples bilinearly in one step, while the thumbnail path
    // shrinks on load and then reduces with a Lanczos-3 kernel.
    const fake = fakeVips()

    await createRunner(fake.load).run(
      { task: task('jpg', 'jpg', 'resize'), files: [file()], image: { width: 640, height: 480 } },
      new AbortController().signal,
      () => {},
    )

    expect(fake.opens.at(-1)).toEqual({
      kind: 'thumbnailBuffer',
      bytes: expect.any(Uint8Array),
      width: 640,
      options: { height: 480, size: 'down' },
    })
  })

  it('leaves the unconstrained axis free when only one dimension is given', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      { task: task('png', 'png', 'resize'), files: [file()], image: { height: 300 } },
      new AbortController().signal,
      () => {},
    )

    const open = fake.opens.at(-1)
    if (open?.kind !== 'thumbnailBuffer') throw new Error('expected the resize path')
    expect(open.width).toBeGreaterThan(65_500)
    expect(open.options).toMatchObject({ height: 300 })
  })

  it('refuses to enlarge unless asked, so no detail is invented', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run(
      { task: task('png', 'png', 'resize'), files: [file()], image: { width: 4000 } },
      signal,
      () => {},
    )
    await runner.run(
      {
        task: task('png', 'png', 'resize'),
        files: [file()],
        image: { width: 4000, enlarge: true },
      },
      signal,
      () => {},
    )

    // Without `enlarge` there is nothing to do: the source is 1200 x 800 and
    // capping the scale at 1 leaves it exactly as it is, so the job never
    // reaches a scaler at all. With `enlarge` it does, in libvips' `both` mode.
    expect(thumbnailSizes(fake)).toEqual(['both'])
  })

  it('crops in source coordinates, before anything else touches the image', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      {
        task: task('jpg', 'jpg', 'crop'),
        files: [file()],
        image: { crop: { left: 100, top: 50, width: 400, height: 300 } },
      },
      new AbortController().signal,
      () => {},
    )

    expect(fake.stages).toEqual([
      { kind: 'extractArea', left: 100, top: 50, width: 400, height: 300 },
    ])
  })

  it('scales what survived the crop, not the original', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      {
        task: task('jpg', 'jpg', 'crop'),
        files: [file()],
        image: { crop: { left: 0, top: 0, width: 800, height: 800 }, width: 200 },
      },
      new AbortController().signal,
      () => {},
    )

    // A 200-wide box against an 800 x 800 crop is a quarter; against the
    // 1200 x 800 original it would have been a sixth, and would have letterboxed
    // an image that no longer has that shape.
    expect(fake.stages).toEqual([
      { kind: 'extractArea', left: 0, top: 0, width: 800, height: 800 },
      { kind: 'resize', scale: 0.25, options: { vscale: 0.25 } },
    ])
  })

  it('stretches by scaling the two axes apart once the aspect lock is off', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      {
        task: task('jpg', 'jpg', 'resize'),
        files: [file()],
        image: { width: 600, height: 600, lockAspectRatio: false },
      },
      new AbortController().signal,
      () => {},
    )

    // No crop, so this still goes through the shrink-on-load path — libvips'
    // own `force` is what "ignore the proportions" compiles to.
    expect(thumbnailSizes(fake)).toEqual(['force'])
  })

  it('rotates and flips in that order, after the resize', async () => {
    const fake = fakeVips()

    await createRunner(fake.load).run(
      {
        task: task('jpg', 'jpg', 'rotate'),
        files: [file()],
        image: { width: 600, rotate: 90, flip: 'horizontal' },
      },
      new AbortController().signal,
      () => {},
    )

    expect(fake.stages).toEqual([
      { kind: 'resize', scale: 0.5, options: { vscale: 0.5 } },
      { kind: 'rot', angle: 'd90' },
      { kind: 'flip', direction: 'horizontal' },
    ])
  })

  it('opens the whole image only for the operations that read it backwards', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run(
      {
        task: task('jpg', 'jpg', 'crop'),
        files: [file()],
        image: { crop: { left: 0, top: 0, width: 400, height: 300 } },
      },
      signal,
      () => {},
    )
    await runner.run(
      { task: task('jpg', 'jpg', 'rotate'), files: [file()], image: { rotate: 180 } },
      signal,
      () => {},
    )

    // Cropping reads forwards and keeps the streaming pipeline the 4x factor in
    // `MEMORY.vips` is priced on. Rotating does not, and pays for it in memory.
    const accesses = fake.opens.map((open) => open.options?.access)
    expect(accesses).toEqual(['sequential', 'sequential', 'sequential', 'random'])
  })

  it('refuses to rotate an image this device could not hold uncompressed', async () => {
    const fake = fakeVips()
    // 20 000 x 20 000 is 400 megapixels: 3.2 GB at eight bytes a pixel, from a
    // file the router waved through on its byte count alone.
    fake.size = { width: 20_000, height: 20_000 }

    await expect(
      createRunner(fake.load).run(
        {
          task: task('jpg', 'jpg', 'rotate'),
          files: [file()],
          image: { rotate: 90 },
          budgetBytes: 90 * 1024 * 1024,
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/20000 × 20000 pixels/)

    expect(fake.writes).toEqual([])
  })

  it('still converts an image far too large to rotate, because converting streams', async () => {
    const fake = fakeVips()
    fake.size = { width: 20_000, height: 20_000 }

    const out = await createRunner(fake.load).run(
      { task: task('jpg', 'png'), files: [file()], budgetBytes: 90 * 1024 * 1024 },
      new AbortController().signal,
      () => {},
    )

    expect(out.size).toBe(4)
  })

  it('refuses a crop area that overlaps nothing, before opening a codec', async () => {
    const fake = fakeVips()

    await expect(
      createRunner(fake.load).run(
        {
          task: task('jpg', 'jpg', 'crop'),
          files: [file()],
          image: { crop: { left: 5000, top: 5000, width: 100, height: 100 } },
        },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow(/does not overlap the image/)

    expect(fake.writes).toEqual([])
    expect(fake.images.every((image) => image.deleted)).toBe(true)
  })

  it('passes quality to lossy encoders only, clamped into libvips range', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run({ task: task('png', 'jpg'), files: [file()] }, signal, () => {})
    await runner.run(
      { task: task('png', 'webp'), files: [file()], image: { quality: 55 } },
      signal,
      () => {},
    )
    await runner.run(
      { task: task('jpg', 'png'), files: [file()], image: { quality: 55 } },
      signal,
      () => {},
    )
    await runner.run(
      { task: task('png', 'jpg'), files: [file()], image: { quality: 5000 } },
      signal,
      () => {},
    )

    expect(fake.writes.map((write) => write.options?.Q)).toEqual([80, 55, undefined, 100])
  })

  it('searches the quality scale for a requested output size', async () => {
    const fake = fakeVips()
    // 100 bytes a quality point: 4000 admits quality 40 and refuses 41.
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100

    const out = await createRunner(fake.load).run(
      { task: task('jpg', 'jpg', 'compress'), files: [file()], image: { targetBytes: 4000 } },
      new AbortController().signal,
      () => {},
    )

    // 4000 bytes is quality 40's output, the largest that fits. The delivered
    // file is that attempt's own bytes — the search keeps its winner rather than
    // re-encoding at the end, which would cost a ninth pass.
    expect(out.size).toBe(4000)
    expect(fake.writes.map((write) => write.options?.Q)).toContain(40)
  })

  it('re-opens the source for every attempt, so each encode gets its own sequential pass', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100

    await createRunner(fake.load).run(
      { task: task('png', 'webp', 'compress'), files: [file()], image: { targetBytes: 4000 } },
      new AbortController().signal,
      () => {},
    )

    // libvips lets a sequentially-opened image be read exactly once, so a second
    // `writeToBuffer` on the same handle would fail. Re-opening also keeps the
    // 4x expansion factor in `MEMORY.vips` honest: a random-access pipeline
    // would materialise the whole bitmap to allow re-reads.
    //
    // One open ahead of the attempts: the header probe that measures the source
    // so the geometry can be planned once rather than per encode.
    expect(fake.opens).toHaveLength(fake.writes.length + 1)
    expect(fake.opens.every((open) => open.kind === 'newFromBuffer')).toBe(true)
    // Every handle released, not just the winner's: Embind handles are not
    // garbage collected, so a leaked attempt is a full image on the WASM heap.
    expect(fake.images.every((image) => image.deleted)).toBe(true)
  })

  it('spends one encode when full quality already meets the target', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = () => 1000

    await createRunner(fake.load).run(
      { task: task('jpg', 'jpg', 'compress'), files: [file()], image: { targetBytes: 50_000 } },
      new AbortController().signal,
      () => {},
    )

    expect(fake.writes.map((write) => write.options?.Q)).toEqual([100])
  })

  it('delivers the smallest file it could make when the target is unreachable', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100

    const out = await createRunner(fake.load).run(
      { task: task('jpg', 'jpg', 'compress'), files: [file()], image: { targetBytes: 10 } },
      new AbortController().signal,
      () => {},
    )

    // The user asked to compress; the most compressed file there is remains the
    // answer, and failing the job would leave them with nothing at all.
    expect(out.size).toBe(100)
  })

  it('ignores a target size for a lossless output, which has no quality dial to turn', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = () => 9999

    await createRunner(fake.load).run(
      { task: task('jpg', 'png', 'compress'), files: [file()], image: { targetBytes: 10 } },
      new AbortController().signal,
      () => {},
    )

    // Eight identical re-encodes of a PNG cannot make it smaller; one is honest.
    expect(fake.writes).toHaveLength(1)
    expect(fake.writes[0].options).toEqual({ keep: 'none', compression: 6 })
  })

  it('lets a target size override a quality the user also set', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100

    const out = await createRunner(fake.load).run(
      {
        task: task('jpg', 'jpg', 'compress'),
        files: [file()],
        image: { quality: 95, targetBytes: 4000 },
      },
      new AbortController().signal,
      () => {},
    )

    // Quality 95 produces 9500 bytes, which is the file the user just said was
    // too large. The more specific request wins.
    expect(out.size).toBe(4000)
  })

  it('reports progress that only ever climbs across a multi-attempt search', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100
    fake.duringWrite = (image) => image.onProgress(50)
    const seen: number[] = []

    await createRunner(fake.load).run(
      { task: task('jpg', 'jpg', 'compress'), files: [file()], image: { targetBytes: 4000 } },
      new AbortController().signal,
      (progress) => seen.push(progress),
    )

    expect(seen[0]).toBe(-1)
    expect(seen.at(-1)).toBe(1)
    const ticks = seen.slice(1)
    expect(ticks).toEqual([...ticks].sort((a, b) => a - b))
  })

  it('stops the search as soon as the job is cancelled', async () => {
    const fake = fakeVips()
    fake.bytesForQuality = (quality) => (quality ?? 100) * 100
    const controller = new AbortController()
    fake.duringWrite = () => controller.abort()

    await expect(
      createRunner(fake.load).run(
        { task: task('jpg', 'jpg', 'compress'), files: [file()], image: { targetBytes: 4000 } },
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // Cancelled during the first attempt: the search must not go on to spend
    // seven more full re-encodes of an image nobody is waiting for.
    expect(fake.writes).toHaveLength(1)
  })

  it('strips metadata by default and keeps it only on request', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run({ task: task('tiff', 'jpg'), files: [file()] }, signal, () => {})
    await runner.run(
      { task: task('tiff', 'jpg'), files: [file()], image: { keepMetadata: true } },
      signal,
      () => {},
    )

    expect(fake.writes.map((write) => write.options?.keep)).toEqual(['none', 'all'])
  })

  it('loads the HEIF side module for AVIF and HEIC, and for nothing else', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run({ task: task('tiff', 'png'), files: [file()] }, signal, () => {})
    await runner.run({ task: task('heic', 'jpg'), files: [file()] }, signal, () => {})
    await runner.run({ task: task('png', 'avif'), files: [file()] }, signal, () => {})

    // The third job needs the same side module as the second, so it reuses it.
    expect(fake.loads).toEqual([[], [VIPS_HEIF_WASM]])
  })

  it('keeps one module warm across jobs, and shuts the old one down when it swaps', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await runner.run({ task: task('tiff', 'png'), files: [file()] }, signal, () => {})
    await runner.run({ task: task('gif', 'webp'), files: [file()] }, signal, () => {})

    // Same side modules: booting libvips a second time costs seconds for nothing.
    expect(fake.loads).toHaveLength(1)
    expect(fake.shutdowns).toBe(0)

    await runner.run({ task: task('png', 'avif'), files: [file()] }, signal, () => {})

    // Emscripten resolves dynamic libraries at instantiation, so a job that
    // needs one the warm module lacks has to replace it rather than extend it.
    expect(fake.loads).toHaveLength(2)
    expect(fake.shutdowns).toBe(1)
  })

  it('releases the Embind handle, including when encoding throws', async () => {
    const fake = fakeVips()
    fake.duringWrite = () => {
      throw new Error('unsupported colour space')
    }

    await expect(
      createRunner(fake.load).run(
        { task: task('tiff', 'png'), files: [file()] },
        new AbortController().signal,
        () => {},
      ),
    ).rejects.toThrow('unsupported colour space')

    expect(fake.images.every((image) => image.deleted)).toBe(true)
  })

  it('opens indeterminate, forwards libvips percentages as fractions, and ends at 1', async () => {
    const fake = fakeVips()
    fake.duringWrite = (image) => {
      image.onProgress(0)
      image.onProgress(50)
      image.onProgress(101)
    }
    const seen: number[] = []

    await createRunner(fake.load).run(
      { task: task('tiff', 'png'), files: [file()] },
      new AbortController().signal,
      (progress) => seen.push(progress),
    )

    expect(seen).toEqual([-1, 0, 0.5, 1, 1])
  })

  it('refuses a job that was cancelled before it started', async () => {
    const fake = fakeVips()
    const controller = new AbortController()
    controller.abort()

    await expect(
      createRunner(fake.load).run(
        { task: task('tiff', 'png'), files: [file()] },
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    expect(fake.loads).toEqual([])
  })

  it('kills the pipeline when the signal fires mid-encode, and delivers no output', async () => {
    const fake = fakeVips()
    const controller = new AbortController()
    fake.duringWrite = () => controller.abort()

    await expect(
      createRunner(fake.load).run(
        { task: task('tiff', 'png'), files: [file()] },
        controller.signal,
        () => {},
      ),
    ).rejects.toMatchObject({ name: 'AbortError' })

    // `kill` is the only handle on a synchronous WASM call; libvips checks it
    // between scanline regions. The header probe is long released by then, which
    // is why it is the pipeline's own handle that carries the flag.
    expect(fake.images.at(-1)?.kill).toBe(true)
    expect(fake.images.every((image) => image.deleted)).toBe(true)
  })

  it('stops listening on the signal once the job is over', async () => {
    const fake = fakeVips()
    const controller = new AbortController()
    const remove = vi.spyOn(controller.signal, 'removeEventListener')

    await createRunner(fake.load).run(
      { task: task('tiff', 'png'), files: [file()] },
      controller.signal,
      () => {},
    )

    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function))
  })

  it('converts exactly one image at a time, and says so', async () => {
    const fake = fakeVips()
    const runner = createRunner(fake.load)
    const signal = new AbortController().signal

    await expect(
      runner.run({ task: task('tiff', 'png'), files: [] }, signal, () => {}),
    ).rejects.toThrow(/one image at a time/)
    await expect(
      runner.run({ task: task('tiff', 'png'), files: [file(), file()] }, signal, () => {}),
    ).rejects.toThrow(/2 files/)
  })

  it('loads nothing until it is actually given a job', () => {
    const fake = fakeVips()

    createRunner(fake.load)

    expect(fake.loads).toEqual([])
  })
})
