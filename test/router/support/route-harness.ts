// The fixtures every `route-*.test.ts` file in this directory shares.
//
// The router suite was one 875-line file until issue #167 split it by subject.
// Each part still needs the same devices, the same tasks and the same stand-in
// descriptors, so they live here once — a copy of the Capabilities literal per
// split file would be a worse outcome than the file-size violation was.
//
// Nothing here imports `@/lib/engines/registry` at run time: the test files mock
// that module, and a helper importing it would close the loop back through the
// mock factory below.

import { afterEach, beforeEach, vi } from 'vitest'

import type { EngineDescriptor } from '@/lib/engines/types'
import type {
  Capabilities,
  ConversionTask,
  EngineId,
  RouteResult,
  WarningCode,
} from '@/lib/router/types'

export const MB = 1024 * 1024
export const GB = 1024 * MB

type Registry = typeof import('@/lib/engines/registry')

/**
 * The engine list `route()` sees, swapped per test.
 *
 * `ENGINES` ships empty and will grow one engine at a time over the next dozen
 * issues. Asserting selection against whichever engines happen to have landed
 * would make every new engine break these tests, so the suite drives the router
 * with fake descriptors instead. The registry's own contract — filter by
 * `supports`, order by `byPreference` — is tested for real in
 * `test/engines/registry.test.ts`; the mock below reuses the registry's actual
 * `byPreference`, so the ordering rule the router depends on cannot drift out
 * from under it.
 */
const registered: EngineDescriptor[] = []

/**
 * The replacement module each test file hands to `vi.mock`.
 *
 * `vi.mock` is hoisted to the top of the file that calls it, so the call itself
 * cannot be shared — only what it returns. Every test file therefore keeps a
 * two-line factory that awaits this module and delegates here. Awaiting it is
 * what guarantees `registered` is initialised before the factory reads it: the
 * factory runs while the test file's own imports are still being evaluated, so
 * a plain top-level import of this module would not be ready in time.
 */
export function mockedRegistry(actual: Registry): Registry {
  return {
    ...actual,
    ENGINES: registered,
    enginesFor: (task: ConversionTask, caps: Capabilities): readonly EngineDescriptor[] =>
      registered.filter((engine) => engine.supports(task, caps)).sort(actual.byPreference),
  }
}

/** Empties the registry before each test and drops any spy after it. */
export function resetRegistryBetweenTests(): void {
  beforeEach(() => {
    registered.length = 0
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })
}

export const desktop: Capabilities = {
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

export const ios: Capabilities = {
  ...desktop,
  crossOriginIsolated: false,
  deviceMemoryGb: 2,
  cores: 4,
  webCodecsVideo: false,
  webCodecsAudio: false,
  platform: 'ios',
  browser: 'safari',
}

export const android: Capabilities = {
  ...desktop,
  deviceMemoryGb: 4,
  cores: 6,
  platform: 'android',
}

export const heicToJpg: ConversionTask = { from: 'heic', to: 'jpg', op: 'convert' }
export const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }
export const mp4ToWebm: ConversionTask = { from: 'mp4', to: 'webm', op: 'convert' }
export const mp4ToMp3: ConversionTask = { from: 'mp4', to: 'mp3', op: 'extract' }
export const tiffToPng: ConversionTask = { from: 'tiff', to: 'png', op: 'convert' }
export const pdfMerge: ConversionTask = { from: 'pdf', to: 'pdf', op: 'merge' }

/** Registers descriptors for the current test. Cleared again in `beforeEach`. */
export function register(...engines: EngineDescriptor[]): void {
  registered.push(...engines)
}

/** Runs `body` against exactly `engines`, so one test can cover several registries. */
export function withEngines<T>(engines: EngineDescriptor[], body: () => T): T {
  registered.length = 0
  registered.push(...engines)
  return body()
}

/** A descriptor with sane defaults; each test overrides only what it cares about. */
export function fake(id: EngineId, overrides: Partial<EngineDescriptor> = {}): EngineDescriptor {
  return { id, label: id, loadCost: 0, priority: 50, supports: () => true, ...overrides }
}

const IMAGE_FORMATS = new Set(['jpg', 'png', 'webp', 'bmp'])
const MEDIA_FORMATS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'mp3', 'wav', 'ogg', 'm4a'])

const isImage = (task: ConversionTask) => IMAGE_FORMATS.has(task.from) && IMAGE_FORMATS.has(task.to)
const isMedia = (task: ConversionTask) => MEDIA_FORMATS.has(task.from) || MEDIA_FORMATS.has(task.to)

/**
 * Stand-ins for the engines EPICs 4–6 will ship, carrying the priorities and
 * download sizes from the plan's priority table so the ordering assertions mean
 * something. Their `supports` predicates are as coarse as a real descriptor's:
 * synchronous, and decided from the task and the device only.
 */
export const canvas = () =>
  fake('canvas', { label: 'Canvas (built in)', priority: 10, loadCost: 0, supports: isImage })

export const webcodecs = () =>
  fake('webcodecs', {
    label: 'Hardware-accelerated (WebCodecs)',
    priority: 15,
    loadCost: 120_000,
    supports: (task, caps) => isMedia(task) && caps.webCodecsVideo,
  })

export const heif = () =>
  fake('heif', {
    label: 'libheif',
    priority: 35,
    loadCost: 900_000,
    supports: (task) => task.from === 'heic',
  })

export const vips = () =>
  fake('vips', {
    label: 'wasm-vips',
    priority: 40,
    loadCost: 5_500_000,
    supports: (task) => task.from === 'tiff' || task.to === 'tiff',
  })

export const ffmpeg = () =>
  fake('ffmpeg', { label: 'ffmpeg.wasm', priority: 90, loadCost: 32_000_000, supports: isMedia })

export const pdflib = () => fake('pdflib', { label: 'pdf-lib', priority: 20, supports: () => true })

/** Narrows to the success branch, failing the test rather than the assertion. */
export function chosen(result: RouteResult) {
  if (!result.ok) throw new Error(`expected an engine, got ${result.code}: ${result.message}`)
  return result
}

/** Narrows to the rejection branch. */
export function refused(result: RouteResult) {
  if (result.ok) throw new Error(`expected a rejection, got engine ${result.engine}`)
  return result
}

export const warningCodes = (result: RouteResult): WarningCode[] =>
  chosen(result).warnings.map((warning) => warning.code)
