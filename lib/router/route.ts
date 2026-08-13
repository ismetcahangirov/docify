/**
 * Engine selection: given a task, an input size and this device's capabilities,
 * decide which engine runs the job — or explain, concretely, why none can.
 *
 * `route()` is the only place in the app allowed to answer "which engine?".
 * A component that reasons "if this is an mp4, use ffmpeg" duplicates the memory
 * budget, the priority table and the codec gates, and then drifts from them
 * (CLAUDE.md §2.4).
 *
 * Three properties hold and are enforced by `test/router/route.test.ts`:
 *
 * - **Pure.** No `await`, no I/O, no `navigator`, no `window`, no probing. Every
 *   input arrives as a parameter, which is what lets the whole selection matrix
 *   run in milliseconds under `@vitest-environment node` and keeps the module
 *   safe to evaluate during SSR.
 * - **Ordering belongs to the registry.** `enginesFor` returns candidates
 *   already sorted by `byPreference`; this module only ever *filters* that list
 *   and takes its head. Re-sorting here would fork the priority table.
 * - **Rejections explain themselves.** Every branch that returns `ok: false`
 *   fills in `message` with the actual numbers and `suggestion` with something
 *   the user can go and do (CLAUDE.md §2.5).
 */

import { enginesFor } from '@/lib/engines/registry'
import type { EngineDescriptor } from '@/lib/engines/types'

import { fitsInBudget, maxInputBytes } from './budget'
import type {
  Capabilities,
  ConversionTask,
  FormatId,
  RouteRejection,
  RouteResult,
  Warning,
} from './types'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

/**
 * Download size above which the engine binary is worth warning about.
 *
 * Strictly above: `wasm-vips` is 5.5 MB and must stay silent, while
 * `ffmpeg.wasm` at 32 MB must not. 8 MB is roughly two seconds on a median
 * connection — the point at which a progress-free pause starts to read as a
 * broken page rather than as a page that is loading.
 */
export const LARGE_DOWNLOAD_BYTES = 8 * MB

const VIDEO_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>(['mp4', 'webm', 'mov', 'mkv', 'avi'])

const AUDIO_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>([
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'flac',
  'aac',
])

/**
 * Formats that discard information when they are written.
 *
 * Used for the `QUALITY_LOSS` warning, which fires only when *both* ends of the
 * pair are lossy — that is the generation-loss case, where the user re-encodes
 * already-degraded data and loses a little more. Writing a lossy file from a
 * lossless one (PNG → JPG) is a deliberate, expected trade and is not warned
 * about; the reverse (JPG → PNG) adds no new loss at all.
 *
 * WebP and AVIF can technically be written losslessly, but every engine we ship
 * writes them lossily by default, so they are listed here.
 */
const LOSSY_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpg',
  'webp',
  'avif',
  'gif',
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mp3',
  'ogg',
  'm4a',
  'aac',
])

/**
 * Picks the engine for `task`, or refuses with a reason the user can act on.
 *
 * The order of the checks below is load-bearing and matches §1.6 of the plan:
 *
 * 1. `EMPTY_INPUT` — before the registry is touched at all, so a zero-byte file
 *    never depends on which engines happen to be registered.
 * 2. Candidate lookup — an empty result *is* the `UNSUPPORTED_PAIR` signal.
 * 3. Memory budget — nothing that cannot fit in RAM survives.
 * 4. Codec viability — see {@link missingCapability}.
 * 5. The head of what is left wins.
 */
export function route(task: ConversionTask, inputBytes: number, caps: Capabilities): RouteResult {
  if (!Number.isFinite(inputBytes) || inputBytes <= 0) return emptyInput()

  // Already sorted by `byPreference`; every step below preserves that order.
  const candidates = enginesFor(task, caps)
  if (candidates.length === 0) return unsupportedPair(task)

  const affordable = candidates.filter((engine) => fitsInBudget(engine.id, inputBytes, caps))
  if (affordable.length === 0) return tooLarge(task, inputBytes, caps, candidates)

  const viable = affordable.filter((engine) => missingCapability(engine, task, caps) === null)
  if (viable.length === 0) return codecUnavailable(task, affordable[0], caps)

  const chosen = viable[0]

  return {
    ok: true,
    engine: chosen.id,
    reason: chosen.label,
    loadCost: chosen.loadCost,
    warnings: warningsFor(chosen, task, caps),
  }
}

/**
 * The browser API `engine` needs for `task` and this device does not have, or
 * `null` when the engine can run.
 *
 * This deliberately overlaps with `EngineDescriptor.supports`, and the overlap
 * is the point. `supports` is a single synchronous predicate covering a whole
 * family of pairs, so it tends to gate on the coarsest capability the family
 * needs — a video engine checks `webCodecsVideo` and is then handed an
 * audio-extraction job it cannot encode. Re-checking here is defence in depth:
 * the worst case for a missed gate is the engine failing halfway through a
 * conversion with a `NotSupportedError` the user cannot interpret, whereas the
 * worst case for the check is a rejection that names the missing API.
 *
 * Kept to capabilities that are structural — an engine that *is* a browser API
 * cannot exist without it. Anything softer belongs in `supports`.
 */
function missingCapability(
  engine: EngineDescriptor,
  task: ConversionTask,
  caps: Capabilities,
): string | null {
  if (engine.id === 'webcodecs') {
    return needsVideoCodecs(task)
      ? caps.webCodecsVideo
        ? null
        : 'VideoEncoder / VideoDecoder'
      : caps.webCodecsAudio
        ? null
        : 'AudioEncoder / AudioDecoder'
  }

  if (engine.id === 'canvas') {
    return caps.createImageBitmap || caps.offscreenCanvas
      ? null
      : 'createImageBitmap / OffscreenCanvas'
  }

  return null
}

/**
 * Whether the job has to move video frames, rather than only audio.
 *
 * Writing a video format always does. Reading one usually does too — except
 * when the output is audio, which is a demux-and-transcode of the audio track
 * with the video stream discarded untouched.
 */
function needsVideoCodecs(task: ConversionTask): boolean {
  if (VIDEO_FORMATS.has(task.to)) return true
  return VIDEO_FORMATS.has(task.from) && !AUDIO_FORMATS.has(task.to)
}

/**
 * What the user should know about a job that *is* going to run.
 *
 * The order is fixed — slowest-first, then the reason it is slow, then the wait
 * before it starts, then the cost to the file — so the UI can render the list
 * verbatim and the most consequential warning is always the one at the top.
 */
function warningsFor(
  engine: EngineDescriptor,
  task: ConversionTask,
  caps: Capabilities,
): Warning[] {
  const warnings: Warning[] = []

  if (engine.id === 'ffmpeg') {
    warnings.push({
      code: 'SLOW_PATH',
      message:
        'No hardware acceleration is available for this format, so the conversion will take noticeably longer.',
    })

    if (!caps.crossOriginIsolated) {
      warnings.push({
        code: 'NO_ISOLATION',
        message:
          'Running single-threaded: this page is not cross-origin isolated, so only one CPU core can be used.',
      })
    }
  }

  if (engine.loadCost > LARGE_DOWNLOAD_BYTES) {
    warnings.push({
      code: 'LARGE_DOWNLOAD',
      message: `${engine.label} is a ${formatBytes(engine.loadCost)} one-time download; it is cached afterwards.`,
    })
  }

  if (LOSSY_FORMATS.has(task.from) && LOSSY_FORMATS.has(task.to)) {
    warnings.push({
      code: 'QUALITY_LOSS',
      message: `${name(task.from)} and ${name(task.to)} are both lossy formats, so re-encoding gives up a little quality.`,
    })
  }

  return warnings
}

function emptyInput(): RouteRejection {
  return {
    ok: false,
    code: 'EMPTY_INPUT',
    message: 'There are 0 bytes to convert — this file is empty, or its size could not be read.',
    suggestion: 'Pick a different file, or re-export it from the app that created it.',
  }
}

function unsupportedPair(task: ConversionTask): RouteRejection {
  return {
    ok: false,
    code: 'UNSUPPORTED_PAIR',
    message: `Converting ${name(task.from)} to ${name(task.to)} is not something this browser can do here.`,
    suggestion: `Choose a different output format for your ${name(task.from)} file, or open this page in an up-to-date Chrome or Edge, where more engines are available.`,
  }
}

/**
 * No engine can hold this file in the device's memory budget.
 *
 * The limit quoted is the *roomiest* candidate's, not the preferred one's: the
 * user is being told the largest file that could possibly work here, so quoting
 * a hungrier engine's ceiling would understate it.
 *
 * The code differs by platform because the fix does. On a desktop the file is
 * the problem and can be split; on a phone the ceiling is the browser's own
 * per-tab limit and no amount of splitting raises it.
 */
function tooLarge(
  task: ConversionTask,
  inputBytes: number,
  caps: Capabilities,
  candidates: readonly EngineDescriptor[],
): RouteRejection {
  const roomiest = candidates.reduce((a, b) =>
    maxInputBytes(a.id, caps) >= maxInputBytes(b.id, caps) ? a : b,
  )
  const limit = maxInputBytes(roomiest.id, caps)
  const onDesktop = caps.platform === 'desktop'

  return {
    ok: false,
    code: onDesktop ? 'FILE_TOO_LARGE' : 'DEVICE_TOO_WEAK',
    message: `This file is ${formatBytes(inputBytes)}. The largest ${name(task.from)} file this device can convert safely is ${formatBytes(limit)}.`,
    suggestion: onDesktop
      ? 'Split the file into smaller parts, or shrink it before converting — everything runs in this tab, so the memory limit is the tab and not the machine.'
      : 'Open this page on a desktop computer: a mobile browser caps each tab well below the memory this file needs.',
  }
}

/**
 * The job fits in memory, but the engines that could run it need a browser API
 * this device does not expose. Distinct from `UNSUPPORTED_PAIR`, which means
 * the conversion is not implemented at all: this one succeeds elsewhere.
 */
function codecUnavailable(
  task: ConversionTask,
  best: EngineDescriptor,
  caps: Capabilities,
): RouteRejection {
  const missing = missingCapability(best, task, caps) ?? 'a required browser API'

  return {
    ok: false,
    code: 'CODEC_UNAVAILABLE',
    message: `Converting ${name(task.from)} to ${name(task.to)} needs ${missing}, which this browser does not provide.`,
    suggestion:
      'Open this page in an up-to-date Chrome or Edge, where the WebCodecs API is available.',
  }
}

/** `'mp4'` → `'MP4'`, for user-facing copy. */
function name(format: FormatId): string {
  return format.toUpperCase()
}

/**
 * Byte counts as a person would read them. One decimal place only in the GB
 * range, where a rounded whole number would hide the difference between a file
 * that is slightly over the limit and one that is nowhere near it.
 */
function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`
  return `${Math.round(bytes / KB)} KB`
}
