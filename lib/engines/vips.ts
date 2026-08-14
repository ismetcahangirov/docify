/**
 * The wasm-vips engine: AVIF, TIFF, GIF, and every resize where detail matters.
 *
 * ## Why it exists next to Canvas
 *
 * Canvas is free and instant, so it wins every pair it can serve (priority 10
 * against 40). It cannot serve these, though: browsers decode AVIF and animated
 * GIF but will not *encode* either, none of them read TIFF at all, and
 * `drawImage` downscales with a bilinear filter that turns fine texture to mush
 * in a single step. libvips reduces with a Lanczos-3 kernel after a shrink-on-
 * load pass, which is why "high-quality resize" routes here even for a JPEG that
 * Canvas could technically re-encode.
 *
 * ## What gates it
 *
 * The vendored build is compiled with pthreads: its WebAssembly memory is
 * `shared`, so instantiating it needs `SharedArrayBuffer`, so the *document*
 * must be cross-origin isolated. `next.config.ts` sends COOP/COEP on `/convert/*`
 * and `/tools/*` only, and isolation is a property of the document rather than
 * the device — a soft navigation from a marketing page carries the un-isolated
 * state across. `supports()` therefore reads `caps.crossOriginIsolated`, and the
 * router simply picks something else when it is false. Letting the engine be
 * chosen and fail at `new WebAssembly.Memory({ shared: true })` would surface as
 * an unexplained crash several seconds into a 5 MB download.
 *
 * ## Lazy loading
 *
 * Only the descriptor below is statically importable. `createRunner` reaches
 * wasm-vips through `./vips-runtime`, which fetches the vendored package by URL
 * at run time — no bundler ever sees the binary (CLAUDE.md §2.3).
 */

import type { Capabilities, ConversionTask } from '@/lib/router/types'

import { type ImageOptions, wantsResize } from './image-options'
import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'
import {
  mimeType,
  needsHeifModule,
  saveOptions,
  saveSuffix,
  VIPS_OPERATIONS,
  VIPS_READABLE,
  VIPS_WRITABLE,
} from './vips-formats'
import {
  loadVips,
  VIPS_BASE_LOAD_COST,
  VIPS_HEIF_WASM,
  type VipsImage,
  type VipsLoader,
  type VipsModule,
} from './vips-runtime'

/**
 * Stands in for "no limit on this axis" when only one of width/height is given.
 *
 * libvips fits the image inside a width × height box, so the unconstrained axis
 * needs a number no real image reaches. libvips itself refuses dimensions above
 * roughly 65 500 px, so a million is unreachable by construction.
 */
const UNBOUNDED_DIMENSION = 1_000_000

export const descriptor: EngineDescriptor = {
  id: 'vips',
  label: 'High-quality image processing (wasm-vips)',
  /**
   * The base download only. An AVIF or HEIC job additionally fetches the 3.3 MB
   * `vips-heif.wasm` side module — see `./vips-runtime` — which is charged to
   * neither this number nor the `LARGE_DOWNLOAD` warning, because `loadCost` is
   * per engine and the router has no per-task hook for it.
   */
  loadCost: VIPS_BASE_LOAD_COST,
  priority: 40,
  supports(task: ConversionTask, caps: Capabilities): boolean {
    if (!VIPS_OPERATIONS.has(task.op)) return false
    if (!VIPS_READABLE.has(task.from) || !VIPS_WRITABLE.has(task.to)) return false

    // SIMD is what makes the AV1 and WebP encoders usable rather than merely
    // present; isolation is what makes the module instantiate at all.
    return caps.wasmSimd && caps.crossOriginIsolated
  },
}

/**
 * Builds the runner. Heavy work is deferred to the first `run()`, not done here:
 * which side modules to load depends on the job, and booting libvips takes
 * seconds that the user has not asked to spend until there is a file.
 *
 * `load` is injectable so the engine can be exercised against a fake module,
 * with no browser and no WASM runtime.
 */
export function createRunner(load: VipsLoader = loadVips): EngineRunner {
  let loaded: { key: string; module: VipsModule } | null = null

  /**
   * One module is kept warm between jobs — it costs seconds to boot. A job that
   * needs a side module the warm one lacks replaces it: Emscripten resolves
   * dynamic libraries at instantiation, so they cannot be added afterwards.
   */
  async function moduleFor(libraries: readonly string[]): Promise<VipsModule> {
    const key = libraries.join(',')
    if (loaded?.key === key) return loaded.module

    loaded?.module.shutdown()
    loaded = null

    const vips = await load(libraries)
    loaded = { key, module: vips }
    return vips
  }

  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const source = onlyFile(input)
      const options = input.image
      const bytes = new Uint8Array(await source.arrayBuffer())
      throwIfAborted(signal)

      const libraries = needsHeifModule(input.task.from, input.task.to) ? [VIPS_HEIF_WASM] : []
      const vips = await moduleFor(libraries)
      throwIfAborted(signal)

      return encode(vips, bytes, input.task, options, signal, onProgress)
    },
  }
}

/**
 * Decodes, optionally resizes and re-encodes, in one libvips pipeline.
 *
 * Nothing is evaluated until `writeToBuffer`: `newFromBuffer` and
 * `thumbnailBuffer` build a lazy pipeline, and the single synchronous write at
 * the end is where the pixels — and the progress ticks — actually happen.
 */
function encode(
  module: VipsModule,
  bytes: Uint8Array,
  task: ConversionTask,
  options: ImageOptions | undefined,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Blob {
  // libvips reports percentages only once it can estimate the work, and the
  // whole pipeline runs inside one synchronous call. Indeterminate is the honest
  // opening state; real ticks overwrite it as soon as there are any.
  onProgress(-1)

  const image = open(module, bytes, options)
  const cancel = () => {
    // Checked by libvips between scanline regions, which is the only place a
    // synchronous WASM call can be interrupted from the outside.
    image.kill = true
  }

  try {
    image.onProgress = (percent) => onProgress(clampFraction(percent / 100))
    signal.addEventListener('abort', cancel, { once: true })

    const written = image.writeToBuffer(saveSuffix(task.to), saveOptions(task.to, options))

    // A killed pipeline returns whatever it had rather than throwing, so the
    // cancel is enforced here instead of trusted to libvips.
    throwIfAborted(signal)
    onProgress(1)

    // Copied out of the WASM heap: the view returned above is backed by memory
    // libvips is free to reuse, and a Blob built on it would decode to noise.
    return new Blob([new Uint8Array(written)], { type: mimeType(task.to) })
  } finally {
    signal.removeEventListener('abort', cancel)
    // Embind handles are not garbage collected. Miss this and the WASM heap
    // grows by a full decoded image per conversion until the tab dies.
    image.delete()
  }
}

/**
 * Opens the source, resizing on the way in when a target size was asked for.
 *
 * `thumbnailBuffer` rather than a decode followed by `resize`, because it is the
 * whole reason this engine beats Canvas on quality *and* on memory: it shrinks
 * on load where the codec allows it (JPEG DCT scaling, WebP and AVIF thumbnail
 * scaling), reduces the remainder with a Lanczos-3 kernel, and premultiplies
 * alpha so edges do not darken. A decoded-then-resized 8000 px JPEG would hold
 * the full bitmap; this holds a few scanlines.
 */
function open(module: VipsModule, bytes: Uint8Array, options: ImageOptions | undefined): VipsImage {
  if (!wantsResize(options)) {
    // Sequential access lets libvips stream the image in scanline regions rather
    // than materialise it, which is what the router's 4× expansion factor
    // assumes (`MEMORY.vips` in `lib/router/budget.ts`).
    return module.Image.newFromBuffer(bytes, '', { access: 'sequential' })
  }

  return module.Image.thumbnailBuffer(bytes, options?.width ?? UNBOUNDED_DIMENSION, {
    height: options?.height ?? UNBOUNDED_DIMENSION,
    size: options?.enlarge === true ? 'both' : 'down',
  })
}

/**
 * The single source file, or an error naming what was actually passed.
 *
 * Image conversion is one file in, one file out. `EngineInput.files` is a list
 * because `merge` and `split` need one, so the constraint has to be enforced
 * here rather than in the type.
 */
function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `wasm-vips converts one image at a time, but was given ${input.files.length} files.`,
    )
  }

  return input.files[0]
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}

/** libvips can report slightly over 100, and reports nothing at all on failure. */
function clampFraction(value: number): number {
  if (!Number.isFinite(value)) return -1

  return Math.min(Math.max(value, 0), 1)
}
