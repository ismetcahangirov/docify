/**
 * Running one ffmpeg job, and leaving nothing behind.
 *
 * ## MEMFS is a leak waiting to happen
 *
 * ffmpeg's filesystem lives inside the WASM heap, and the heap outlives the job:
 * the core is kept warm between conversions because booting it costs seconds
 * against a 31 MB module. So a file written and not deleted stays resident for
 * the rest of the session — and these are whole videos. Two conversions of a
 * 200 MB clip without cleanup is 800 MB of heap that nothing will ever reclaim,
 * on a budget of at most 1200 MB.
 *
 * Every path therefore ends in {@link removeQuietly} for both names, in a
 * `finally`: success, failure, and cancellation alike. `test/engines/ffmpeg-run.test.ts`
 * asserts an empty filesystem after each.
 *
 * ## Cancellation, in a synchronous call
 *
 * `exec` is one call into WebAssembly and does not return until ffmpeg is
 * finished, so the worker's message loop cannot deliver an abort while it runs —
 * the same shape `lib/worker/types.ts` describes, where the escalation is
 * killing the whole worker.
 *
 * ffmpeg itself provides the way out. The vendored build checks a deadline from
 * inside its own encoding loop, and the progress callback runs from inside that
 * loop too. So the abort listener sets a deadline that has already passed, and
 * the next thing ffmpeg does is give up — measured at half a second into a
 * thirty-second encode, against the thirty seconds it would otherwise have
 * taken. That is real cooperative cancellation, and it is why this engine does
 * not need the sledgehammer.
 */

import { throwIfAborted } from '@/lib/abort'

import type { FfmpegJob } from './ffmpeg-args'
import { ffmpegArgs, ffmpegTargetFor } from './ffmpeg-args'
import type { FfmpegCore, FfmpegLogMessage } from './ffmpeg-runtime'
import type { ProgressCallback } from './types'

/** Where the input and the output live inside MEMFS. */
const INPUT_PATH = '/input'
const OUTPUT_PATH = '/output'

/**
 * A deadline in the past, which is how a running job is stopped.
 *
 * ffmpeg compares it against its own elapsed seconds, so any value at or below
 * zero is already missed. One millisecond rather than zero because zero is the
 * library's own "no deadline".
 */
const CANCEL_DEADLINE_SECONDS = 0.001

/** No deadline at all, which is what every job starts with. */
const NO_DEADLINE = -1

/** How many of ffmpeg's own log lines to keep for a failure message. */
const KEPT_LOG_LINES = 12

export interface FfmpegRunRequest {
  core: FfmpegCore
  bytes: Uint8Array
  job: Omit<FfmpegJob, 'input' | 'output'>
  signal: AbortSignal
  onProgress: ProgressCallback
}

/** What one finished job produced, and how to label it. */
export interface FfmpegResult {
  bytes: Uint8Array<ArrayBuffer>
  mimeType: string
}

/**
 * Writes the input, runs ffmpeg, reads the output, and clears the filesystem.
 *
 * The extension on each MEMFS path is what tells ffmpeg which demuxer and muxer
 * to use — it reads the container from the bytes, but it picks the *output*
 * format from the name alone, and an extensionless output makes it refuse the
 * job with "Unable to find a suitable output format".
 */
export async function runFfmpeg(request: FfmpegRunRequest): Promise<FfmpegResult> {
  const { core, bytes, job, signal, onProgress } = request

  throwIfAborted(signal)

  const target = ffmpegTargetFor(job.to)
  const input = `${INPUT_PATH}.${extensionOf(job)}`
  const output = `${OUTPUT_PATH}.${job.to}`

  const log: string[] = []
  const cancel = () => core.setTimeout(CANCEL_DEADLINE_SECONDS)

  try {
    core.reset()
    core.setLogger((message) => keep(log, message))
    // Fractions only: ffmpeg reports a negative value for an input whose
    // duration it could not read, which is honest and is what -1 means here.
    core.setProgress(({ progress }) => onProgress(progress >= 0 ? Math.min(progress, 1) : -1))

    core.FS.writeFile(input, bytes)
    throwIfAborted(signal)

    signal.addEventListener('abort', cancel, { once: true })
    const status = core.exec(...ffmpegArgs({ ...job, input, output }))

    // Checked before the status: a cancelled run exits non-zero, and reporting
    // that as a conversion failure would tell the user their file was broken.
    throwIfAborted(signal)
    if (status !== 0) throw failed(job.to, log)

    const produced = core.FS.readFile(output)
    // Copied out of the heap before the file is unlinked: what `readFile`
    // returns is a view onto memory the unlink releases.
    const copy = new Uint8Array(produced.length)
    copy.set(produced)

    onProgress(1)

    return { bytes: copy, mimeType: target.mimeType }
  } finally {
    signal.removeEventListener('abort', cancel)
    // Both names, always. See the module header.
    removeQuietly(core, input)
    removeQuietly(core, output)
    // The deadline and the exit status belong to the job that just ended; a
    // cancelled one would otherwise stop the next job before it started.
    core.setTimeout(NO_DEADLINE)
    core.reset()
    core.setLogger(() => {})
    core.setProgress(() => {})
  }
}

/**
 * Deletes a path, ignoring the case where it was never created.
 *
 * A failed run usually leaves no output, and a job cancelled before the write
 * leaves no input either. Neither is a reason to raise something over the error
 * that actually matters.
 */
export function removeQuietly(core: FfmpegCore, path: string): void {
  try {
    core.FS.unlink(path)
  } catch {
    // Not there. Nothing to release and nothing to report.
  }
}

/**
 * The extension the input file is given inside MEMFS.
 *
 * ffmpeg detects an input's container from its bytes, so this is only a hint —
 * but a wrong one is worse than none for the formats whose probe is ambiguous,
 * and the router already knows what the user said the file was.
 */
function extensionOf(job: Omit<FfmpegJob, 'input' | 'output'>): string {
  return job.from
}

/**
 * Keeps the last few log lines, for a failure message.
 *
 * ffmpeg writes its banner, its build configuration and a line per stream to
 * stderr before it does anything, and none of that explains a failure. What
 * does is whatever it said last, so the buffer is a short tail rather than a
 * transcript — and it never grows, on a job that may log thousands of lines.
 */
function keep(log: string[], message: FfmpegLogMessage): void {
  const line = message.message.trim()
  if (line.length === 0) return

  log.push(line)
  if (log.length > KEPT_LOG_LINES) log.shift()
}

function failed(to: string, log: readonly string[]): Error {
  const detail = log.at(-1)

  return new Error(
    `This file could not be converted to ${to.toUpperCase()}` +
      `${detail === undefined ? '' : ` (${detail})`}. ` +
      'If it plays in a media player, the conversion settings may be the problem; if it does ' +
      'not, the file itself is damaged.',
  )
}
