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
 *   branch quotes real numbers and names something the user can go and do.
 *
 * None of the words are here. This module decides; `./rejections` says why a
 * job was refused, `./warnings` says what an accepted one will cost, and
 * `./formats` answers the questions that are about a format pair rather than
 * about a device. Keeping the four apart is what lets a sentence be argued with
 * without reopening the decision that produced it — and it is why `route()`
 * itself is short enough to read in one screen (CLAUDE.md §5.2).
 *
 * Sizes are binary: "MB" in user-facing copy means 1 048 576 bytes.
 */

import { enginesFor } from '@/lib/engines/registry'
import type { EngineDescriptor } from '@/lib/engines/types'

import { cheapestFor, fitsBitmapCeiling, fitsInBudget } from './budget'
import { codecKind } from './formats'
import { isMeasurable, jobInput } from './job'
import { codecUnavailable, emptyInput, tooLarge, unsupportedPair } from './rejections'
import type {
  Capabilities,
  ConversionTask,
  JobInput,
  RouteInput,
  RouteOptions,
  RouteResult,
} from './types'
import { overBudget, warningsFor } from './warnings'

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
 * 4. Memory budget — nothing that cannot fit in RAM survives, unless the user
 *    has read the refusal and asked for it anyway. See {@link overBudgetRoute}.
 * 5. The head of what is left wins.
 *
 * `input` is one size, or one size per file for a job made of several. The
 * distinction matters at step 4 and nowhere else: merging a hundred documents
 * holds all hundred at once, while converting a hundred images holds one of
 * them at a time, and only the engine's own model knows which it is.
 *
 * `options` is the user's own say in it and defaults to saying nothing, so
 * every existing three-argument call keeps the behaviour it had.
 */
export function route(
  task: ConversionTask,
  input: RouteInput,
  caps: Capabilities,
  options: RouteOptions = {},
): RouteResult {
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
  if (affordable.length === 0) {
    return options.allowOverBudget === true
      ? overBudgetRoute(task, job, caps, viable)
      : tooLarge(task, job, caps, viable)
  }

  const chosen = affordable[0]

  return {
    ok: true,
    engine: chosen.id,
    reason: chosen.label,
    loadCost: chosen.loadCost,
    warnings: warningsFor(chosen, task),
  }
}

/**
 * The job nothing can afford, run anyway because the user said so (issue #322).
 *
 * Reached only from `route()`, and only with `allowOverBudget` — which means a
 * person has read the `FILE_TOO_LARGE` sentence, with its real numbers in it,
 * and asked for the conversion regardless. The home page promises no limit on
 * file size; this is the half of that promise the budget was quietly retracting.
 *
 * Two things do not yield with the budget.
 *
 * The **bitmap ceiling** is filtered out first. It is not an estimate about
 * memory at all: past `MAX_CANVAS_PIXELS` a canvas comes back blank rather than
 * throwing, so overriding it trades a refusal for a silently wrong image, which
 * is the one outcome worse than a crash. With no candidate left after that
 * filter there is nothing to accept, and the ordinary refusal stands.
 *
 * The **capability gate** never got this far: it runs above, and a browser with
 * no `VideoEncoder` does not acquire one by being asked twice.
 *
 * The engine chosen is the cheapest for this job rather than the head of the
 * list, and that is the whole difference between this and the path above. The
 * priority table orders engines by how *well* they do the job — hardware
 * acceleration, download size — and that ranking is worth having while the job
 * fits. Once nothing fits, the only question left is which candidate is least
 * likely to take the tab down, and `cheapestFor` is the same engine the
 * rejection would have quoted a ceiling for.
 */
function overBudgetRoute(
  task: ConversionTask,
  job: JobInput,
  caps: Capabilities,
  viable: readonly [EngineDescriptor, ...EngineDescriptor[]],
): RouteResult {
  const [first, ...rest] = viable.filter((engine) => fitsBitmapCeiling(engine.id, job))
  if (first === undefined) return tooLarge(task, job, caps, viable)

  const chosen = cheapestFor([first, ...rest], job)

  return {
    ok: true,
    engine: chosen.id,
    reason: chosen.label,
    loadCost: chosen.loadCost,
    // First, ahead of the fixed order `warningsFor` documents. That order ranks
    // warnings by consequence, and nothing else in the list can cost the user
    // the tab: a slow path wastes minutes and a lossy re-encode costs quality,
    // while this one is the reason the job was refused a moment ago.
    warnings: [overBudget(chosen.id, job, caps), ...warningsFor(chosen, task)],
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
