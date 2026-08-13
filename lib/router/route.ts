/**
 * Engine selection: given a task, an input size and this device's capabilities,
 * decide which engine runs the job — or explain, concretely, why none can.
 *
 * `route()` is the only place allowed to answer "which engine?" (CLAUDE.md
 * §2.4). A component that reasons "if this is an mp4, use ffmpeg" duplicates
 * the budget model, the priority table and the codec gates, and then drifts
 * from all three.
 *
 * Three properties hold, and `test/router/route.test.ts` enforces them:
 *
 * - **Pure.** No `await`, no I/O, no `navigator`, no `window`, no probing —
 *   every input arrives as a parameter. That is what lets the whole selection
 *   matrix run in milliseconds without a browser, and keeps the module safe to
 *   evaluate during SSR.
 * - **Ordering belongs to the registry.** `enginesFor` returns candidates
 *   already sorted by `byPreference`; this module only ever *filters* that list
 *   and takes its head. Re-sorting here would fork the priority table.
 * - **Rejections explain themselves** (CLAUDE.md §2.5): every `ok: false`
 *   branch quotes real numbers and names something the user can go and do.
 *
 * Sizes are binary: "MB" in user-facing copy means 1 048 576 bytes.
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
 * `ffmpeg.wasm` at ~31 MB must not. 8 MB is roughly two seconds on a median
 * connection — where a progress-free pause starts to read as a broken page.
 */
export const LARGE_DOWNLOAD_BYTES = 8 * MB

const VIDEO_FORMATS: ReadonlySet<FormatId> = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])
const AUDIO_FORMATS: ReadonlySet<FormatId> = new Set(['mp3', 'wav', 'ogg', 'm4a', 'flac', 'aac'])
const LOSSY_IMAGE_FORMATS: ReadonlySet<FormatId> = new Set(['jpg', 'webp', 'avif', 'gif', 'heic'])
const LOSSLESS_AUDIO_FORMATS: ReadonlySet<FormatId> = new Set(['wav', 'flac'])

/**
 * Whether writing this format throws information away.
 *
 * WebP, AVIF and HEIC all have lossless modes on paper; every engine we ship
 * writes them lossily by default, so they count as lossy here. Video containers
 * are lossy because the codecs inside them are.
 */
function isLossy(format: FormatId): boolean {
  if (LOSSY_IMAGE_FORMATS.has(format) || VIDEO_FORMATS.has(format)) return true
  return AUDIO_FORMATS.has(format) && !LOSSLESS_AUDIO_FORMATS.has(format)
}

/**
 * Picks the engine for `task`, or refuses with a reason the user can act on.
 *
 * The order of the checks is load-bearing:
 *
 * 1. `EMPTY_INPUT` — before the registry is touched, so a zero-byte file never
 *    depends on which engines happen to be registered.
 * 2. Candidate lookup — an empty result *is* the `UNSUPPORTED_PAIR` signal.
 * 3. Codec viability — see {@link missingCapability}. This runs *before* the
 *    budget filter so that the size ceiling quoted by a `FILE_TOO_LARGE` is one
 *    an engine that can actually run the job would honour; the other order lets
 *    the router promise a limit and then refuse the file that meets it.
 * 4. Memory budget — nothing that cannot fit in RAM survives.
 * 5. The head of what is left wins.
 */
export function route(task: ConversionTask, inputBytes: number, caps: Capabilities): RouteResult {
  if (!Number.isFinite(inputBytes) || inputBytes <= 0) return emptyInput()

  // Already sorted by `byPreference`; every step below preserves that order.
  const candidates = enginesFor(task, caps)
  if (candidates.length === 0) return unsupportedPair(task)

  const viable = candidates.filter((engine) => missingCapability(engine, task, caps) === null)
  if (viable.length === 0) return codecUnavailable(task, candidates, caps)

  const affordable = viable.filter((engine) => fitsInBudget(engine.id, inputBytes, caps))
  if (affordable.length === 0) return tooLarge(task, inputBytes, caps, viable)

  const chosen = affordable[0]

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
 * is the point. `supports` is one synchronous predicate covering a whole family
 * of pairs, so it gates on the coarsest capability the family needs — a video
 * engine checks `webCodecsVideo` and is then handed an audio-extraction job it
 * cannot encode. A missed gate costs the user a conversion that dies half way
 * through with a `NotSupportedError` they cannot interpret; this catches it and
 * names the API instead. Restricted to structural capabilities — engines that
 * *are* a browser API. Anything softer belongs in `supports`.
 */
function missingCapability(
  engine: EngineDescriptor,
  task: ConversionTask,
  caps: Capabilities,
): string | null {
  if (engine.id === 'webcodecs') {
    const kind = codecKind(task)
    if (kind === 'video') return caps.webCodecsVideo ? null : 'VideoEncoder / VideoDecoder'
    if (kind === 'audio') return caps.webCodecsAudio ? null : 'AudioEncoder / AudioDecoder'
    // Neither end is timed media (an animated image, say): not a codec question.
    return null
  }

  if (engine.id === 'canvas') {
    // Both halves are needed in a worker, where there is no DOM canvas:
    // `createImageBitmap` to decode and `OffscreenCanvas` to encode.
    if (!caps.createImageBitmap) return 'createImageBitmap'
    if (!caps.offscreenCanvas) return 'OffscreenCanvas'
  }

  return null
}

/**
 * Which family of codecs the job has to drive, or `null` when it drives none.
 *
 * Writing a video format always needs video codecs. Reading one usually does
 * too — except when the output is audio, which is a demux plus an audio
 * transcode, the video stream discarded untouched.
 */
function codecKind(task: ConversionTask): 'video' | 'audio' | null {
  if (VIDEO_FORMATS.has(task.to)) return 'video'
  if (VIDEO_FORMATS.has(task.from)) return AUDIO_FORMATS.has(task.to) ? 'audio' : 'video'
  if (AUDIO_FORMATS.has(task.from) || AUDIO_FORMATS.has(task.to)) return 'audio'
  return null
}

/**
 * What the user should know about a job that *is* going to run.
 *
 * The order is fixed — how slow, why it is slow, the wait before it starts,
 * then the cost to the file — so the UI can render the list verbatim with the
 * most consequential warning first.
 *
 * `QUALITY_LOSS` is deliberately coarse: it reads the format pair, not the
 * settings, so a container remux that an engine could stream-copy losslessly
 * (mkv → mp4) still warns. Narrowing that needs the engine's own answer about
 * whether it will copy or transcode, which is not available at routing time.
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

  if (isLossy(task.from) && isLossy(task.to)) {
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
    message: 'There are no bytes to convert — this file is empty, or its size could not be read.',
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
 * The job fits on this device, but every engine that could run it needs a
 * browser API this device does not expose. Distinct from `UNSUPPORTED_PAIR`,
 * which means the conversion is not implemented at all: this one succeeds
 * elsewhere, so the suggestion names the APIs that are actually missing rather
 * than a fixed one.
 */
function codecUnavailable(
  task: ConversionTask,
  candidates: readonly EngineDescriptor[],
  caps: Capabilities,
): RouteRejection {
  const missing = [
    ...new Set(candidates.map((engine) => missingCapability(engine, task, caps) ?? '')),
  ].filter(Boolean)
  const named = missing.length > 0 ? missing.join(' and ') : 'a browser API'

  return {
    ok: false,
    code: 'CODEC_UNAVAILABLE',
    message: `Converting ${name(task.from)} to ${name(task.to)} needs ${named}, which this browser does not provide.`,
    suggestion: `Open this page in an up-to-date Chrome or Edge, which provides ${named}.`,
  }
}

/**
 * No engine can hold this file inside the device's memory budget.
 *
 * The limit quoted is the *roomiest* candidate's, not the preferred one's: the
 * user is being told the largest file that could work here, so quoting a
 * hungrier engine's ceiling would understate it. Only engines that passed the
 * capability gate are considered, so the number is one this device can honour.
 *
 * The code differs by platform because the fix does. On a desktop the file is
 * the problem and can be split; on a phone the ceiling is the browser's own
 * per-tab limit, and no amount of splitting raises it.
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

/** `'mp4'` → `'MP4'`, for user-facing copy. */
function name(format: FormatId): string {
  return format.toUpperCase()
}

/**
 * Byte counts as a person would read them. One decimal place only in the GB
 * range, where rounding whole would hide the difference between a file slightly
 * over the limit and one nowhere near it.
 */
function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`
  return `${Math.round(bytes / KB)} KB`
}
