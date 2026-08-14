/**
 * The pdf-lib engine: everything that edits a PDF's structure rather than its
 * pixels — merge, split, reorder, rotate, delete — plus building a document out
 * of JPEG and PNG images.
 *
 * ## Why it is separate from pdfjs
 *
 * pdf-lib parses a document into an object tree, mutates it and serialises it
 * back. It never rasterises, so it cannot answer "PDF → JPG"; pdf.js rasterises
 * and cannot write, so it cannot answer "merge". Two libraries, two engines,
 * one `supports()` each — which is what keeps the router from picking a path
 * that fails after the download.
 *
 * ## What gates it
 *
 * Nothing. pdf-lib is plain JavaScript: no WASM, no SIMD, no
 * `SharedArrayBuffer`, no canvas. `supports()` therefore reads the task alone,
 * and a five-year-old phone on an un-isolated document still merges PDFs. The
 * only ceiling is the memory budget, and `EXPANSION.pdflib` in
 * `lib/router/budget.ts` is what enforces it.
 *
 * ## How the operations are wired
 *
 * One module per operation, reached through `await import()`. The library is
 * half a megabyte; a user who came to rotate one page should not download the
 * code that assembles images into documents, and — more importantly — nothing
 * here may end up in the initial bundle (CLAUDE.md §2.3).
 */

import type { ConversionTask, FormatId, Operation } from '@/lib/router/types'

import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

/**
 * Size of `pdf-lib/dist/pdf-lib.esm.min.js`, measured rather than estimated.
 * Re-measure when the dependency is upgraded: the router quotes this number to
 * the user in the `LARGE_DOWNLOAD` warning.
 */
export const PDFLIB_LOAD_COST = 525_000

/**
 * Operations that read a PDF and write a PDF.
 *
 * `protect` and `unlock` are deliberately absent. pdf-lib can neither encrypt
 * nor decrypt, so claiming them here would route a job to an engine that cannot
 * finish it; issue #43 decides what actually serves them.
 */
const STRUCTURAL_OPERATIONS: ReadonlySet<Operation> = new Set([
  'merge',
  'split',
  'organize',
  'rotate',
])

/**
 * The image formats pdf-lib can embed. It ships a JPEG and a PNG parser and
 * nothing else — a TIFF or a HEIC has to be converted by a raster engine first,
 * so this engine must not claim it.
 */
const EMBEDDABLE_IMAGES: ReadonlySet<FormatId> = new Set(['jpg', 'png'])

export const descriptor: EngineDescriptor = {
  id: 'pdflib',
  label: 'PDF document editing (pdf-lib)',
  loadCost: PDFLIB_LOAD_COST,
  // Between canvas (10) and pdfjs (30). Only ever compared against another
  // engine claiming the same task, which today is nothing — the number exists
  // so that ffmpeg's future PDF-adjacent claims lose to it.
  priority: 20,
  supports(task: ConversionTask): boolean {
    if (STRUCTURAL_OPERATIONS.has(task.op)) return task.from === 'pdf' && task.to === 'pdf'

    // Images in, one document out. The reverse direction belongs to pdfjs.
    return task.op === 'convert' && task.to === 'pdf' && EMBEDDABLE_IMAGES.has(task.from)
  },
}

/**
 * What every operation module exports. Identical to `EngineRunner.run` so that
 * an operation can be driven directly by its own test, with no engine around it.
 */
export type PdfOperation = (
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
) => Promise<Blob>

/**
 * Builds the runner. No work happens here and no module is loaded: which half
 * megabyte of pdf-lib code a job needs depends on the operation, and the
 * operation is not known until `run()`.
 */
export function createRunner(): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const operation = await loadOperation(input.task)
      throwIfAborted(signal)

      return operation(input, signal, onProgress)
    },
  }
}

/**
 * Resolves the module that serves `task.op`.
 *
 * Each `case` is owned by one issue and replaced by exactly one `await import()`
 * when that issue lands. This is the one file the parallel EPIC 5 branches do
 * still share, and deliberately the smallest possible version of it: a one-line
 * edit per issue, in a `case` no other issue touches, which a three-way merge
 * resolves on its own. Anything larger — a shared helper, a restyled dispatch,
 * a new parameter — has to be agreed rather than merged, so it does not belong
 * here. The specifier stays a literal
 * string in each branch for the same reason it does in `lib/worker/api.ts`: a
 * computed import defeats the bundler's static analysis and collapses every
 * operation into one chunk.
 */
async function loadOperation(task: ConversionTask): Promise<PdfOperation> {
  switch (task.op) {
    case 'merge':
      throw notImplemented('merge', 38)
    case 'split':
      return (await import('./pdf-split')).splitPdf
    case 'organize':
    case 'rotate':
      return (await import('./pdf-organize')).organizePages
    case 'convert':
      return (await import('./pdf-from-images')).imagesToPdf
    default:
      // Reached only if `supports()` and this switch disagree, which is a
      // routing bug rather than anything the user did.
      throw new Error(
        `The pdf-lib engine was handed the "${task.op}" operation, which it never claims.`,
      )
  }
}

/**
 * The placeholder every unimplemented operation throws.
 *
 * An engine that returned an empty document instead would look like a
 * successful conversion and hand the user a broken file; naming the operation
 * and its issue makes the gap unmistakable in a log and in the UI.
 */
function notImplemented(operation: string, issue: number): Error {
  return new Error(
    `The pdf-lib engine cannot run the "${operation}" operation yet — issue #${issue} implements it.`,
  )
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
