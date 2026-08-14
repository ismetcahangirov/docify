/**
 * The list of every engine the router may choose between.
 *
 * This module is the one place that imports engine descriptors *statically*, and
 * it must stay that way. A descriptor is a handful of numbers and a predicate, so
 * importing all of them costs nothing; a runner drags a multi-megabyte WASM binary
 * behind it. Keeping the two apart is what lets the router know about ffmpeg
 * without shipping ffmpeg to a user who only ever converts a PNG.
 *
 * Therefore, in this file:
 *
 * - no `import()` of a runner, no `createRunner`, no WASM, no `navigator`
 * - no side effects at module scope beyond building the list itself
 *
 * Runners are reached exclusively through `dynamic import()` inside the
 * conversion worker, and only after the router has picked the engine.
 *
 * A pair no registered engine claims is not a special case: with no candidates,
 * the router rejects the task with `UNSUPPORTED_PAIR`. (An empty file is caught
 * one step earlier, as `EMPTY_INPUT`.)
 *
 * ## Registering a new engine
 *
 * Condensed from CLAUDE.md §5.4; `.claude/skills/docify-engine` is the
 * authoritative version and covers each step in detail.
 *
 * 1. Create `lib/engines/<id>.ts` exporting `descriptor` and `createRunner`.
 * 2. Add the id to the `EngineId` union in `lib/router/types.ts`.
 * 3. Measure the engine's peak memory use and add its factor to `EXPANSION`
 *    in `lib/router/budget.ts` — guessing here costs the user their tab.
 * 4. Import the descriptor here and add it to `ENGINES`.
 * 5. Slot `priority` *between* existing values; never renumber the others.
 * 6. Add the dynamic-import branch in `lib/worker/conversion.worker.ts`.
 * 7. Add two router test cases: one where the engine wins, one where it loses.
 * 8. Add a unit test for the engine itself, against a real small fixture file.
 * 9. Run `pnpm size` and confirm the initial bundle did not grow.
 */

import { descriptor as canvas } from '@/lib/engines/canvas'
import { descriptor as heif } from '@/lib/engines/heif'
import type { EngineDescriptor } from '@/lib/engines/types'
import type { Capabilities, ConversionTask, EngineId } from '@/lib/router/types'

/**
 * Every known engine, in registration order. Frozen so that an in-place sort by
 * one consumer cannot be felt by the router, the worker or the UI.
 */
export const ENGINES: readonly EngineDescriptor[] = Object.freeze([canvas, heif])

/**
 * Orders two engines by how much we want to run them: `priority` ascending
 * first, and only for engines of equal priority does the cheaper download win.
 *
 * The keys are in that order and not the reverse on purpose. `canvas` needs no
 * download at all and `ffmpeg` needs 32 MB, so cost alone would look like a
 * usable proxy — but `webcodecs` must beat `ffmpeg` for hardware acceleration
 * rather than for its size, and `vips` must beat `canvas` on quality-critical
 * work despite costing 5.5 MB. Priority encodes that judgement; `loadCost` only
 * settles ties.
 *
 * Exported so the ordering can be tested against fake descriptors, which keeps
 * the contract pinned no matter which engines happen to have shipped.
 */
export function byPreference(a: EngineDescriptor, b: EngineDescriptor): number {
  return a.priority - b.priority || a.loadCost - b.loadCost
}

/**
 * The engines that can run `task` on this device, best candidate first, already
 * sorted by `byPreference` — callers take the head of the list and must not
 * re-sort it. An empty result means the router should answer `UNSUPPORTED_PAIR`.
 *
 * Pure and synchronous: `caps` arrives as a parameter and the file itself is
 * never inspected, which keeps the whole selection path testable without a
 * browser. The returned array is always a fresh copy, so `ENGINES` is never
 * reordered.
 */
export function enginesFor(task: ConversionTask, caps: Capabilities): readonly EngineDescriptor[] {
  return ENGINES.filter((engine) => engine.supports(task, caps)).sort(byPreference)
}

/**
 * The descriptor registered under `id`, or `undefined` when no engine has
 * claimed that id yet. An unknown id is not an error: `EngineId` may name an
 * engine that is planned but not yet implemented, and a caller resolving an id
 * back to its label or load cost should degrade rather than throw.
 */
export function getEngine(id: EngineId): EngineDescriptor | undefined {
  return ENGINES.find((engine) => engine.id === id)
}
