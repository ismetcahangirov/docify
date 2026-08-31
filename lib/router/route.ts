/**
 * Engine selection: given a task, an input size and this device's capabilities,
 * decide which engine runs the job — or explain, concretely, why none can.
 *
 * `route()` is the only place allowed to answer "which engine?" (CLAUDE.md
 * §2.4). A component that reasons "if this is an mp4, use ffmpeg" duplicates
 * the budget model, the priority table and the codec gates, and then drifts
 * from all three.
 *
 * Three properties hold. `test/router/route-purity.test.ts` enforces the first
 * two; `test/router/route-rejections.test.ts` enforces the third:
 *
 * - **Pure.** No `await`, no I/O, no `navigator`, no `window`, no probing —
 *   every input arrives as a parameter. That is what lets the whole selection
 *   matrix run in milliseconds without a browser, and keeps the module safe to
 *   evaluate during SSR.
 * - **Ordering belongs to the registry.** `enginesFor` returns candidates
 *   already sorted by `byPreference`; this module only ever *filters* that list
 *   and takes its head. Re-sorting here would fork the priority table.
 * - **Rejections explain themselves** (CLAUDE.md §2.5): every `ok: false`
 *   branch quotes real numbers and names something the user can go and do. The
 *   copy itself lives in `./rejections`, so that this module stays about the
 *   decision and that one about the explanation.
 *
 * Sizes are binary: "MB" in user-facing copy means 1 048 576 bytes.
 */

import { enginesFor } from '@/lib/engines/registry'
import type { EngineDescriptor } from '@/lib/engines/types'

import { fitsInBudget } from './budget'
import { formatBytes, formatName } from './copy'
import { isMeasurable, jobInput } from './job'
import { codecUnavailable, emptyInput, tooLarge, unsupportedPair } from './rejections'
import type {
  Capabilities,
  ConversionTask,
  FormatId,
  RouteInput,
  RouteResult,
  Warning,
} from './types'

const MB = 1024 * 1024

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
 * Targets that keep the words and throw the document away.
 *
 * A different loss from `QUALITY_LOSS`, which is about re-encoding: nothing is
 * being re-encoded here, and nothing about the *text* degrades. What is lost is
 * everything that was not text — the layout, the fonts, the images, the tables —
 * because the target format has nowhere to put any of it.
 */
const TEXT_FORMATS: ReadonlySet<FormatId> = new Set(['txt'])

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
 *
 * `input` is one size, or one size per file for a job made of several. The
 * distinction matters at step 4 and nowhere else: merging a hundred documents
 * holds all hundred at once, while converting a hundred images holds one of
 * them at a time, and only the engine's own model knows which it is.
 */
export function route(task: ConversionTask, input: RouteInput, caps: Capabilities): RouteResult {
  const job = jobInput(input)
  if (!isMeasurable(job)) return emptyInput(job)

  // Already sorted by `byPreference`; every step below preserves that order.
  const candidates = enginesFor(task, caps)
  if (candidates.length === 0) return unsupportedPair(task)

  // Destructured rather than length-checked so that `tooLarge` can require a
  // non-empty list in its own signature: it has to name an engine's ceiling, and
  // there is no sentence to write when there is no engine.
  const [firstViable, ...restViable] = candidates.filter(
    (engine) => missingCapability(engine, task, caps) === null,
  )
  if (firstViable === undefined) {
    return codecUnavailable(task, missingCapabilities(candidates, task, caps))
  }

  const viable = [firstViable, ...restViable] as const
  const affordable = viable.filter((engine) => fitsInBudget(engine.id, job, caps))
  if (affordable.length === 0) return tooLarge(task, job, caps, viable)

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
 * Every distinct API named by {@link missingCapability} across `candidates`,
 * de-duplicated and in candidate order.
 *
 * Two engines can be blocked by the same missing API, and a rejection that
 * says "needs OffscreenCanvas and OffscreenCanvas" reads like a bug.
 */
function missingCapabilities(
  candidates: readonly EngineDescriptor[],
  task: ConversionTask,
  caps: Capabilities,
): string[] {
  const named = candidates.map((engine) => missingCapability(engine, task, caps))

  return [...new Set(named.filter((api): api is string => api !== null))]
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

  if (TEXT_FORMATS.has(task.to) && !TEXT_FORMATS.has(task.from)) {
    warnings.push({
      code: 'LAYOUT_LOSS',
      message:
        'A text file holds words and nothing else, so the layout, fonts, images and tables ' +
        'are not carried across. The result is readable text, not an editable copy of the ' +
        'document.',
    })
  }

  if (isLossy(task.from) && isLossy(task.to)) {
    warnings.push({
      code: 'QUALITY_LOSS',
      message: `${formatName(task.from)} and ${formatName(task.to)} are both lossy formats, so re-encoding gives up a little quality.`,
    })
  }

  return warnings
}
