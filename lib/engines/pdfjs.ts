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
 *
 * ## What its memory depends on
 *
 * Not the input size, mostly. A page canvas is sized by the requested DPI, so a
 * 13 kB vector document and a 78 MB scan allocate the same 8.0 MB of RGBA for a
 * US Letter page at the default 150 dpi. `MEMORY.pdfjs` in
 * `lib/router/budget.ts` says so with a `reserveBytes` term that the router
 * takes off the device budget before it looks at the file at all; the DPI and
 * canvas-pixel ceilings in `./pdf-render-plan` are what keep that term true.
 */

import type { Capabilities, ConversionTask, FormatId } from '@/lib/router/types'

import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

/**
 * `legacy/build/pdf.min.mjs` plus `legacy/build/pdf.worker.min.mjs`, measured.
 *
 * Both halves are needed. pdf.js keeps its parser in a worker module and the API
 * entry alone cannot open a document — and Docify declines to spawn that worker,
 * loading the module here instead, for the reasons in `./pdfjs-runtime`.
 *
 * The legacy build rather than the default one, which costs about 108 kB less
 * and calls JavaScript that several current browsers do not have. Pinned by a
 * test that re-measures the installed package, so an upgrade that changes the
 * download fails there rather than quietly making the router's cost model wrong.
 */
export const PDFJS_LOAD_COST = 1_824_935

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
 * Builds the runner. pdf.js is not touched until `run()`: loading it costs 1.8 MB
 * and several hundred milliseconds of parsing, and neither should happen for a
 * job the user may still cancel.
 */
export function createRunner(): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const { task } = input
      if (task.op !== 'convert' || !RENDERABLE_TARGETS.has(task.to)) {
        // Reached only when `supports()` and this disagree, which is a routing
        // bug. Saying so beats downloading pdf.js to discover it.
        throw new Error(
          `The pdf.js engine renders pages to JPG or PNG, not "${task.to}" by "${task.op}".`,
        )
      }

      const { renderPdfPages } = await import('./pdf-render')

      // Loading takes seconds on a slow connection, which makes it the likeliest
      // moment for the user to give up.
      throwIfAborted(signal)

      return renderPdfPages(input, signal, onProgress)
    },
  }
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
