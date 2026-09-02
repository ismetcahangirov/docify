/**
 * The finished half of the queue, as the download list sees it.
 *
 * A pure projection over `QueuedJob[]`: which jobs produced a file, what each
 * file is called, and how much there is altogether. It lives beside the reducer
 * rather than inside the panel because the naming decision it makes is shared —
 * the individual download links and the entries inside the batch archive have to
 * agree, and two components deriving the same name separately is how they stop
 * agreeing.
 */

import type { FormatId } from '@/lib/router/types'

import { outputName } from './output-name'
import type { QueuedJob } from './queue'

/** One converted file, ready to hand to the browser. */
export interface ConversionResult {
  /** The queued job's id, so the panel keys on the same thing the list does. */
  id: string
  /** The download name, already made unique across the batch. */
  name: string
  blob: Blob
  bytes: number
}

/**
 * Every job that has a file to download, in queue order.
 *
 * A job is only included when it is both `done` *and* carrying a blob. The state
 * alone would be enough if nothing else could ever set it, but a panel that
 * trusts it renders a download link pointing at `undefined` the first time
 * something does.
 *
 * Names are made unique as the list is built, so two `scan.heic` files from two
 * folders become `scan.jpg` and `scan-2.jpg` — in arrival order, so the numbering
 * matches the order on screen.
 */
export function finishedResults(
  jobs: readonly QueuedJob[],
  to: FormatId,
): readonly ConversionResult[] {
  const taken = new Set<string>()
  const results: ConversionResult[] = []

  for (const job of jobs) {
    if (job.state !== 'done' || job.result === undefined) continue

    const name = uniqueName(outputName(job.file.name, to), taken)
    taken.add(name)
    results.push({ id: job.id, name, blob: job.result, bytes: job.result.size })
  }

  return results
}

/** What a download-all would weigh, in bytes. */
export function totalResultBytes(results: readonly ConversionResult[]): number {
  return results.reduce((total, result) => total + result.bytes, 0)
}

/**
 * `name`, or the first `-2`, `-3`, ... variant of it that `taken` does not hold.
 *
 * The same rule as `uniqueEntryName` in `lib/engines/zip-output.ts`, which
 * settles collisions *inside* one engine's output. This one settles them
 * *across* jobs, on the main thread, where the engine that produced each file
 * never saw the others. Deliberately not shared: that module is worker-side and
 * importing it here would drag `fflate` into the page bundle for a suffix.
 */
function uniqueName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name

  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)]

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`
    if (!taken.has(candidate)) return candidate
  }
}
