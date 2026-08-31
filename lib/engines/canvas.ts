/**
 * The canvas engine: the browser's own image decoder and encoder, with nothing
 * downloaded to reach them.
 *
 * It sits at priority 10, ahead of everything else, for one reason — it costs
 * zero bytes. `wasm-vips` produces better output and handles far more formats,
 * but it is a 5.5 MB download gated behind WASM SIMD; for the four formats below
 * the difference is a re-encode the user cannot see, against a wait they can.
 * So the plain `jpg ↔ png ↔ webp ↔ bmp` swap belongs here and the interesting
 * work belongs to `vips` (issue #32).
 *
 * ## What it deliberately does not claim
 *
 * `supports` is the format pair and the operation, and nothing else:
 *
 * - **No capability check.** The engine needs `createImageBitmap` to decode and
 *   `OffscreenCanvas` to encode, and `route()` gates on both itself. Repeating
 *   the check here would only downgrade a browser missing them from a
 *   `CODEC_UNAVAILABLE` that names the missing API to a bare `UNSUPPORTED_PAIR`.
 * - **Only `convert`.** It does honour `image.quality` — the same 1..100 scale
 *   the rest of the app uses, converted to the `0..1` a canvas wants — so a
 *   converted JPEG comes out where the user asked for it. What it will not claim
 *   is `compress` or `resize`: `compress` means a *target size*, which costs a
 *   re-encode per attempt and belongs with the encoder that can shrink on load,
 *   and `drawImage` downsamples bilinearly in one step. Both go to `vips`.
 * - **Nothing lossless.** A canvas decodes to RGBA and re-encodes from scratch,
 *   so EXIF, ICC profiles and any lossless JPEG transform are gone. The router's
 *   `QUALITY_LOSS` warning covers the pairs where that shows.
 *
 * ## What its memory depends on
 *
 * `MEMORY.canvas` in `lib/router/budget.ts` is `holds: 'one-at-a-time'`: a batch
 * of images is decoded one after another, so the budget is the largest of them
 * and not their total. The 6× factor is the honest part of the model and the
 * incomplete one — a decoded bitmap is `width × height × 4` regardless of how
 * well the source compressed, so the factor holds for photographs and
 * understates a flat-coloured PNG badly. See the "decoded-pixel ceiling" section
 * of `docs/router/memory-budget-measurement.md`, which explains why closing that
 * gap properly needs a browser measurement harness nobody has built yet.
 *
 * What the runner does refuse is the part that is a *fact* rather than an
 * estimate: an image past what a browser canvas can hold, which comes back as a
 * blank surface rather than an error. `assertBitmapFits` in `./raster-limits`
 * checks it twice — on the header before `createImageBitmap`, and on the decoded
 * bitmap before the canvas — each time before the allocation it guards.
 *
 * ## The two halves
 *
 * This file is the half `registry.ts` imports statically, so it must stay a
 * handful of constants. The encoder, the BMP writer and every browser API live
 * behind `createRunner()`'s `await import()` (CLAUDE.md §2.3) — which is also
 * why they can mention `OffscreenCanvas` while this file cannot.
 */

import type { FormatId } from '@/lib/router/types'

import type { EngineDescriptor, EngineRunner } from './types'

/**
 * The formats a browser can both decode *and* encode without help.
 *
 * Reading is the wider side: `createImageBitmap` also takes GIF, SVG, AVIF and,
 * on Apple hardware, HEIC. Writing is what closes the set — `convertToBlob`
 * writes PNG, JPEG and WebP, and `./bmp` adds the fourth by hand. A format that
 * can only be read is not usable as a *pair* here, so it waits for an engine
 * that can also write it.
 */
export const CANVAS_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpg',
  'png',
  'webp',
  'bmp',
])

export const descriptor: EngineDescriptor = {
  id: 'canvas',
  label: 'Built into your browser',
  loadCost: 0,
  priority: 10,
  supports: (task) =>
    task.op === 'convert' && CANVAS_FORMATS.has(task.from) && CANVAS_FORMATS.has(task.to),
}

/**
 * Loads the runner. The `import()` is the chunk boundary: everything the engine
 * actually executes hangs off it, and nothing behind it reaches a page bundle.
 */
export async function createRunner(): Promise<EngineRunner> {
  const { createCanvasRunner } = await import('./canvas-runner')

  return createCanvasRunner()
}
