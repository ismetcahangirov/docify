/**
 * The pdf.js engine: turning PDF pages into pixels and into text.
 *
 * ## Why it is separate from pdflib
 *
 * pdf.js is a renderer. It understands a document well enough to draw it — with
 * fonts, shading and transparency groups — and cannot write one back out.
 * pdf-lib is the mirror image. Splitting them along that line keeps each
 * `supports()` honest, so the router never picks an engine that will discover
 * halfway through that it cannot finish.
 *
 * ## What gates it
 *
 * `caps.offscreenCanvas`. The runner is on the worker thread, where there is no
 * `document` and therefore no `<canvas>` to render onto; without
 * `OffscreenCanvas` there is no drawing surface at all. Reading the capability
 * in `supports()` turns that into a routed rejection instead of a crash after a
 * 1.7 MB download.
 *
 * ## Lazy loading
 *
 * `pdfjs-dist` is fetched through `await import()` inside the operation module,
 * never here. This file is statically imported by the registry and must stay
 * free of anything heavy (CLAUDE.md §2.3).
 */

import type { Capabilities, ConversionTask, FormatId } from '@/lib/router/types'

import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

/**
 * `pdf.min.mjs` plus `pdf.worker.min.mjs`, measured. Both are needed: pdf.js
 * moves parsing into a worker of its own and the main entry alone cannot open a
 * document. Re-measure on upgrade — the router quotes this to the user.
 */
export const PDFJS_LOAD_COST = 1_717_000

/** What a rendered page can be written as: the raster formats a canvas encodes. */
const RENDERABLE_TARGETS: ReadonlySet<FormatId> = new Set(['jpg', 'png'])

export const descriptor: EngineDescriptor = {
  id: 'pdfjs',
  label: 'PDF page rendering (pdf.js)',
  loadCost: PDFJS_LOAD_COST,
  // Above pdflib (20), below heif (35). The two PDF engines never claim the
  // same task, so the ordering is documentation more than arbitration.
  priority: 30,
  supports(task: ConversionTask, caps: Capabilities): boolean {
    if (task.from !== 'pdf') return false
    if (task.op !== 'convert' || !RENDERABLE_TARGETS.has(task.to)) return false

    return caps.offscreenCanvas
  },
}

/**
 * Builds the runner. pdf.js is not touched until `run()`: booting it spawns a
 * worker and downloads 1.7 MB, and neither should happen for a job the user may
 * still cancel.
 */
export function createRunner(): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      // Replaced by `await import('./pdf-render')` when issue #41 lands. Until
      // then the only honest answer is a throw: an empty image would download
      // as a successful conversion.
      void input
      void onProgress
      throw new Error(
        'The pdf.js engine cannot render pages to images yet — issue #41 implements it.',
      )
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
