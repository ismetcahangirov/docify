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
    expect(descriptor.supports(task('jpg', 'png', 'crop'), isolated)).toBe(false)
    expect(descriptor.supports(task('jpg', 'png', 'rotate'), isolated)).toBe(false)
    expect(descriptor.supports(task('png', 'png', 'merge'), isolated)).toBe(false)
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

    expect(fake.opens[0]).toMatchObject({
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

    expect(fake.opens[0]).toEqual({
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

    const open = fake.opens[0]
    if (open.kind !== 'thumbnailBuffer') throw new Error('expected the resize path')
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

    expect(fake.opens.map((open) => open.options?.size)).toEqual(['down', 'both'])
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

    expect(fake.images.map((image) => image.deleted)).toEqual([true])
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
    // between scanline regions.
    expect(fake.images.map((image) => image.kill)).toEqual([true])
    expect(fake.images.map((image) => image.deleted)).toEqual([true])
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
