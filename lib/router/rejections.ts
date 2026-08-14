/**
 * Everything the router says when it refuses a job.
 *
 * Separate from `route.ts` because the two answer different questions. That
 * module decides *whether* a job can run; this one decides *how to explain* it,
 * which is the half CLAUDE.md §2.5 makes a merge blocker: both `message` and
 * `suggestion` are required fields, and both have to carry real numbers and a
 * next step the user can actually take.
 *
 * Every function here is pure and returns a `RouteRejection`, so the copy can be
 * asserted directly in a test without routing anything.
 *
 * Sizes are binary: "MB" in user-facing copy means 1 048 576 bytes.
 */

import type { EngineDescriptor } from '@/lib/engines/types'

import { MEMORY, heldBytes, maxInputBytes, peakBytes } from './budget'
import { formatBytes, formatName } from './copy'
import type { Capabilities, ConversionTask, JobInput, MemoryScope, RouteRejection } from './types'

/**
 * Nothing here can be budgeted: no files at all, or one among them with no
 * bytes in it.
 *
 * Three sentences rather than one, because the three situations have three
 * different next steps. "This file is empty" in front of a list of ninety-nine
 * good documents and one bad one tells the user nothing about which to look at,
 * and in front of no files at all it is simply untrue.
 */
export function emptyInput(job: JobInput): RouteRejection {
  if (job.fileCount <= 0) {
    return {
      ok: false,
      code: 'EMPTY_INPUT',
      message: 'No files were given, so there is nothing to convert.',
      suggestion: 'Choose at least one file — drop it on the page, or use the file picker.',
    }
  }

  if (job.fileCount === 1) {
    return {
      ok: false,
      code: 'EMPTY_INPUT',
      message: 'There are no bytes to convert — this file is empty, or its size could not be read.',
      suggestion: 'Pick a different file, or re-export it from the app that created it.',
    }
  }

  return {
    ok: false,
    code: 'EMPTY_INPUT',
    message: `One of these ${job.fileCount} files is empty, or its size could not be read, so the job cannot be measured.`,
    suggestion:
      'Remove the empty file from the list — every other file is fine as it is, and the job runs once it has gone.',
  }
}

export function unsupportedPair(task: ConversionTask): RouteRejection {
  return {
    ok: false,
    code: 'UNSUPPORTED_PAIR',
    message: `Converting ${formatName(task.from)} to ${formatName(task.to)} is not something this browser can do here.`,
    suggestion: `Choose a different output format for your ${formatName(task.from)} file, or open this page in an up-to-date Chrome or Edge, where more engines are available.`,
  }
}

/**
 * The job fits on this device, but every engine that could run it needs a
 * browser API this device does not expose. Distinct from `UNSUPPORTED_PAIR`,
 * which means the conversion is not implemented at all: this one succeeds
 * elsewhere, so the suggestion names the APIs that are actually missing rather
 * than a fixed one.
 */
export function codecUnavailable(task: ConversionTask, missing: readonly string[]): RouteRejection {
  const named = missing.length > 0 ? missing.join(' and ') : 'a browser API'

  return {
    ok: false,
    code: 'CODEC_UNAVAILABLE',
    message: `Converting ${formatName(task.from)} to ${formatName(task.to)} needs ${named}, which this browser does not provide.`,
    suggestion: `Open this page in an up-to-date Chrome or Edge, which provides ${named}.`,
  }
}

/**
 * No engine can hold this job inside the device's memory budget.
 *
 * The limit quoted is the *roomiest* candidate's, not the preferred one's: the
 * user is being told the largest job that could work here, so quoting a
 * hungrier engine's ceiling would understate it. Only engines that passed the
 * capability gate are considered, so the number is one this device can honour.
 *
 * "Roomiest" is decided by what each engine would cost *for this job* rather
 * than by comparing their ceilings, because two engines' ceilings can be
 * ceilings on different quantities — one on the job's total and one on its
 * largest file — and those two numbers do not order against each other.
 *
 * What the limit is a limit *on* comes from that engine's own memory model. An
 * engine that opens every file at once is refusing the job's total, and saying
 * "the largest file this device can convert is 292 MB" to somebody whose files
 * are 50 MB each would be a true sentence that explains nothing.
 *
 * The code differs by platform because the fix does. On a desktop the job is
 * the problem and can be broken up; on a phone the ceiling is the browser's own
 * per-tab limit, and no amount of splitting raises it.
 *
 * `candidates` must not be empty: it is the list `route()` has just found to be
 * non-empty and unaffordable, and a rejection with no engine behind it has no
 * number to quote.
 */
export function tooLarge(
  task: ConversionTask,
  job: JobInput,
  caps: Capabilities,
  candidates: readonly [EngineDescriptor, ...EngineDescriptor[]],
): RouteRejection {
  const roomiest = candidates.reduce((a, b) =>
    peakBytes(MEMORY[a.id], job) <= peakBytes(MEMORY[b.id], job) ? a : b,
  )
  const memory = MEMORY[roomiest.id]
  const limit = maxInputBytes(roomiest.id, caps)
  const onDesktop = caps.platform === 'desktop'
  // Whichever quantity that engine's ceiling is a ceiling on — the total across
  // the job, or its largest single file. Quoting the other one would compare
  // two different numbers in the same sentence.
  const over = formatBytes(heldBytes(memory, job))

  return {
    ok: false,
    code: onDesktop ? 'FILE_TOO_LARGE' : 'DEVICE_TOO_WEAK',
    message: `${subject(job, memory.holds, over)} ${ceiling(task, job, memory.holds, formatBytes(limit))}`,
    suggestion: onDesktop ? desktopSuggestion(job, memory.holds) : MOBILE_SUGGESTION,
  }
}

const MOBILE_SUGGESTION =
  'Open this page on a desktop computer: a mobile browser caps each tab well below the memory this job needs.'

/** "This file is 300 MB." / "These 100 files are 4.9 GB together." */
function subject(job: JobInput, holds: MemoryScope, over: string): string {
  if (job.fileCount <= 1) return `This file is ${over}.`

  return holds === 'all-at-once'
    ? `These ${job.fileCount} files are ${over} together.`
    : `The largest of these ${job.fileCount} files is ${over}.`
}

/** The limit, phrased as a ceiling on whatever the engine actually holds. */
function ceiling(task: ConversionTask, job: JobInput, holds: MemoryScope, limit: string): string {
  if (job.fileCount > 1 && holds === 'all-at-once') {
    return `In one job this device can handle ${limit} of ${formatName(task.from)} across every file.`
  }

  return `The largest ${formatName(task.from)} file this device can convert safely is ${limit}.`
}

function desktopSuggestion(job: JobInput, holds: MemoryScope): string {
  if (job.fileCount > 1 && holds === 'all-at-once') {
    return 'Run it in smaller batches and combine the results — everything happens in this tab, so the memory limit is the tab and not the machine.'
  }

  return 'Split the file into smaller parts, or shrink it before converting — everything runs in this tab, so the memory limit is the tab and not the machine.'
}
