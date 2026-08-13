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
 * - **Only `convert`.** `EngineInput` carries no quality, no target size and no
 *   angle yet, so an engine that accepted `resize` would hand back the original
 *   dimensions and call it a success. Those operations arrive with the options
 *   that make them meaningful (issues #33–#35).
 * - **Nothing lossless.** A canvas decodes to RGBA and re-encodes from scratch,
 *   so EXIF, ICC profiles and any lossless JPEG transform are gone. The router's
 *   `QUALITY_LOSS` warning covers the pairs where that shows.
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
