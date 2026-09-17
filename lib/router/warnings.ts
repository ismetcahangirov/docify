/**
 * Everything the router says about a job it is going to run.
 *
 * The mirror of `./rejections`, and split out for the same reason: `./route`
 * decides *what happens*, and these two modules decide *how to say it*. A
 * warning is held to the same bar as a refusal — it quotes real numbers and
 * names the consequence — because a user who is told "this may be slow" and a
 * user who is told "this build uses one CPU core, so long files take a while"
 * make different decisions about whether to wait.
 *
 * Pure, like the rest of `lib/router`.
 */

import type { EngineDescriptor } from '@/lib/engines/types'

import { budgetBytes, MEMORY, peakBytes } from './budget'
import { formatBytes, formatName } from './copy'
import { isLossy, TEXT_FORMATS } from './formats'
import type { Capabilities, ConversionTask, EngineId, JobInput, Warning } from './types'

const MB = 1024 * 1024

/**
 * Download size above which the engine binary is worth warning about.
 *
 * Strictly above: `wasm-vips` is 5.5 MB and must stay silent, while
 * `ffmpeg.wasm` at ~31 MB must not. 8 MB is roughly two seconds on a median
 * connection — where a progress-free pause starts to read as a broken page.
 */
export const LARGE_DOWNLOAD_BYTES = 8 * MB
/**
 * What the user should know about a job that *is* going to run.
 *
 * The order is fixed — how slow, why it is slow, the wait before it starts,
 * then the cost to the file — so the UI can render the list verbatim with the
 * most consequential warning first.
 *
 * `QUALITY_LOSS` is deliberately coarse: it reads the format pair, not the
 * settings, so a job an engine will re-encode warns whatever it does with the
 * bitrate. The one narrowing available at routing time is the engine itself —
 * `remux` is *defined* as a stream copy, so a pair it won is lossless by
 * construction and the warning would be false. Every other engine re-encodes,
 * and for those the pair is still all there is to go on: a codec-level answer
 * about whether a given file could have been copied needs the file open, which
 * the router never does.
 *
 * `Capabilities` is deliberately not a parameter. Every warning here is a fact
 * about the chosen engine or about the format pair, and the device has already
 * had its say by the time one is chosen: it decided which engines were eligible
 * at all. The one warning that used to read it — `NO_ISOLATION` — was reading
 * the wrong thing, and says so at its own site.
 */
export function warningsFor(engine: EngineDescriptor, task: ConversionTask): Warning[] {
  const warnings: Warning[] = []

  if (engine.id === 'ffmpeg') {
    warnings.push({
      code: 'SLOW_PATH',
      message:
        'No hardware acceleration is available for this format, so the conversion will take noticeably longer.',
    })

    // Unconditional, although the code reads like a question about the page.
    // The vendored core is built `--disable-pthreads` (`lib/engines/ffmpeg-runtime.ts`),
    // so it uses one core on an isolated document and one on an ordinary one.
    // Gating this on `caps.crossOriginIsolated` said, by omission, that an
    // isolated page would get the others.
    warnings.push({
      code: 'NO_ISOLATION',
      message:
        'Running single-threaded: this build of ffmpeg uses one CPU core, so long files take a while.',
    })
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

  if (engine.id !== 'remux' && isLossy(task.from) && isLossy(task.to)) {
    warnings.push({
      code: 'QUALITY_LOSS',
      message: `${formatName(task.from)} and ${formatName(task.to)} are both lossy formats, so re-encoding gives up a little quality.`,
    })
  }

  return warnings
}

/**
 * What the user is agreeing to, in the same numbers the refusal used.
 *
 * Both figures are load-bearing. The first is what this job is predicted to
 * cost and the second is what the device was willing to spend, and a warning
 * carrying neither would be the "something went wrong" CLAUDE.md §2.5 forbids —
 * the same bar as a rejection, because this sentence is the only thing standing
 * between the user and a tab that reloads.
 *
 * The last clause is not reassurance for its own sake. A hosted converter that
 * died here would have taken an uploaded copy of the file with it; this one
 * cannot, because the file was never anywhere else, and that is exactly the
 * fact that makes the risk worth offering rather than hiding.
 */
export function overBudget(engine: EngineId, job: JobInput, caps: Capabilities): Warning {
  const needed = formatBytes(peakBytes(MEMORY[engine], job))
  const budget = formatBytes(budgetBytes(caps))

  return {
    code: 'OVER_BUDGET',
    message:
      `This job is expected to need about ${needed}, and this device is only budgeted ${budget}. ` +
      'If the browser runs out of memory the tab reloads and the conversion is lost — your file ' +
      'is untouched, because it never leaves this device.',
  }
}
