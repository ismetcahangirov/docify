/**
 * Turning a routing decision into the job the worker runs.
 *
 * ## Why this is a function and not an object literal at the call site
 *
 * A `ConvertRequest` carries two things the caller cannot invent: the `engine`
 * `route()` chose, and `budgetBytes` — how much memory this device may spend,
 * which `lib/engines/raster-limits.ts` needs beside the pixels it is about to
 * decode. Both come from the same routing call, and both are optional-looking
 * fields on a plain interface, so a literal assembled by hand can omit either
 * and still compile. Omitting `budgetBytes` is the quiet one: every job then
 * falls back to `DEFAULT_BUDGET_BYTES`, the desktop floor of 140 MB, and a
 * phone with a 90 MB budget gets a decoded-pixel ceiling roughly 1.5× too
 * generous — the direction that lets the tab die rather than the direction that
 * refuses a valid job.
 *
 * Taking the accepted `RouteSuccess` and the `Capabilities` it was routed with
 * as one call is what makes them impossible to mismatch: there is no way to
 * pass an engine chosen for one device and a budget computed for another.
 *
 * ## Why the number and not the Capabilities
 *
 * `budgetBytes(caps)` is evaluated here, on the main thread that routed. The
 * worker is handed the answer rather than the inputs because it must not be
 * able to re-decide anything (CLAUDE.md §2.4) — it carries no `Capabilities`
 * and never re-routes.
 */

import type { EngineInput } from '@/lib/engines/types'
import { budgetBytes } from '@/lib/router/budget'
import type { Capabilities, RouteSuccess } from '@/lib/router/types'

import type { ConvertRequest } from './types'

/** Everything about the job except what routing decided. */
export type ConversionSource = Omit<EngineInput, 'budgetBytes'> & Pick<ConvertRequest, 'jobId'>

/**
 * The request for a job `route()` accepted.
 *
 * `routed` must be the result of routing `source.task` against `caps`; passing
 * a decision made for a different device is the one mistake this signature
 * cannot catch, and the reason both arrive together.
 */
export function conversionRequest(
  routed: RouteSuccess,
  caps: Capabilities,
  source: ConversionSource,
): ConvertRequest {
  return { ...source, engine: routed.engine, budgetBytes: budgetBytes(caps) }
}
