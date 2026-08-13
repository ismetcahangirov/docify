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
 * `ENGINES` is empty until the first engine lands, which is the correct
 * behaviour rather than a placeholder: with no candidates the router rejects
 * every task with `UNSUPPORTED_PAIR`.
 *
 * ## Registering a new engine (CLAUDE.md §5.4)
 *
 * 1. Create `lib/engines/<id>.ts` exporting `descriptor` and `createRunner`.
 * 2. Add the id to the `EngineId` union in `lib/router/types.ts`.
 * 3. Measure the engine's peak memory use and add its factor to `EXPANSION`
 *    in `lib/router/budget.ts` — guessing here costs the user their tab.
 * 4. Import the descriptor here and add it to `ENGINES`.
 * 5. Slot `priority` *between* existing values; never renumber the others.
 * 6. Add the dynamic-import branch in `lib/worker/conversion.worker.ts`.
 * 7. Add two router test cases: one where the engine wins, one where it loses.
 * 8. Run `pnpm size` and confirm the initial bundle did not grow.
 */

import type { EngineDescriptor } from './types'
import type { Capabilities, ConversionTask, EngineId } from '@/lib/router/types'

/**
 * Every known engine, in registration order. Frozen because it is shared by the
 * router, the worker and the UI, and a sort in one of them must not be felt by
 * the others.
 */
export const ENGINES: readonly EngineDescriptor[] = Object.freeze([])

/**
 * The engines that can run `task` on this device, best candidate first.
 *
 * Ordered by `priority` ascending, then by `loadCost` ascending, so a cheaper
 * download wins a tie. The sort is stable, so engines equal on both keys stay in
 * registration order.
 *
 * Pure and synchronous: `caps` is a parameter and the file itself is never
 * inspected, which keeps the whole selection path testable without a browser.
 * The returned array is a fresh copy — `registry` is left untouched.
 *
 * @param registry the engines to search. Defaults to `ENGINES`; passing an
 *   explicit list lets ordering be tested independently of which engines ship.
 */
export function enginesFor(
  task: ConversionTask,
  caps: Capabilities,
  registry: readonly EngineDescriptor[] = ENGINES,
): readonly EngineDescriptor[] {
  return registry
    .filter((engine) => engine.supports(task, caps))
    .sort((a, b) => a.priority - b.priority || a.loadCost - b.loadCost)
}

/**
 * The descriptor registered under `id`, or `undefined` when no engine has
 * claimed that id yet. Unknown ids are not an error: `EngineId` may name an
 * engine that is planned but not yet implemented, and callers resolving an id
 * back to its label or load cost should degrade rather than throw.
 *
 * @param registry the engines to search. Defaults to `ENGINES`.
 */
export function getEngine(
  id: EngineId,
  registry: readonly EngineDescriptor[] = ENGINES,
): EngineDescriptor | undefined {
  return registry.find((engine) => engine.id === id)
}
