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
 *   so any lossless JPEG transform is out of reach, and everything that was not
 *   a pixel — Exif, the ICC profile, XMP, IPTC — is gone by construction. That
 *   is the right default and, for one pair, no longer the only option: see
 *   {@link preservesMetadata}. The router's `QUALITY_LOSS` warning covers the
 *   pairs where the re-encode itself shows.
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

import type { ConversionTask, FormatId } from '@/lib/router/types'

import type { EngineDescriptor, EngineRunner } from './types'

/**
 * The formats this engine can write.
 *
 * `convertToBlob` writes PNG, JPEG and WebP; `./bmp` adds the fourth by hand.
 * Reading is the wider side — see {@link CANVAS_READABLE} — so this is the set
 * that closes a pair.
 */
export const CANVAS_WRITABLE: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpg',
  'png',
  'webp',
  'bmp',
])

/**
 * The formats this engine can read.
 *
 * Everything it writes, plus SVG. `createImageBitmap` also decodes GIF, AVIF
 * and, on Apple hardware, HEIC, and those are deliberately absent: a browser
 * decodes them but nothing here renders them any better than `vips` does, and
 * claiming a pair means claiming responsibility for its quality.
 *
 * SVG is different in kind, which is why it is the one read-only format listed.
 * It is not a picture with a size but a drawing with a *ratio*, so rasterising
 * it is a decision about resolution rather than a re-encode — and the browser's
 * SVG renderer is the only one available without a 3 MB side module libvips does
 * not ship in this build (`VIPS_READABLE` in `./vips-formats`). See
 * `./canvas-svg` for what that decision looks like.
 */
export const CANVAS_READABLE: ReadonlySet<FormatId> = new Set<FormatId>([...CANVAS_WRITABLE, 'svg'])

export const descriptor: EngineDescriptor = {
  id: 'canvas',
  label: 'Built into your browser',
  loadCost: 0,
  priority: 10,
  supports: (task) =>
    task.op === 'convert' && CANVAS_READABLE.has(task.from) && CANVAS_WRITABLE.has(task.to),
}

/**
 * Whether this engine can honour `keepMetadata` for `task`.
 *
 * True for JPEG → JPEG and nothing else. A canvas throws every non-pixel away,
 * so preserving anything means putting the source's own bytes back afterwards —
 * and `./jpeg-metadata` can only do that into a container that has somewhere to
 * put them. A browser's PNG and WebP encoders expose no such hook, and BMP has
 * no metadata chunk at all.
 *
 * JPEG → JPEG is also where it matters: it is what a phone camera writes and
 * what a phone camera's GPS block travels in. libvips carries metadata into PNG,
 * WebP, TIFF and AVIF as well (`saveOptions` in `./vips-formats`), so the wider
 * answer exists — behind a 5.5 MB download and a cross-origin isolated document.
 *
 * Exported rather than kept private because `supports()` decides from the task
 * alone and cannot see the job's options: the router will still choose this
 * engine for a `jpg → png` conversion that asked to keep metadata. This is the
 * fact a caller needs to say so up front, and it lives beside the engine that
 * knows it rather than as a condition inside a component (CLAUDE.md §2.4).
 */
export function preservesMetadata(task: ConversionTask): boolean {
  return task.from === 'jpg' && task.to === 'jpg'
}

/**
 * Loads the runner. The `import()` is the chunk boundary: everything the engine
 * actually executes hangs off it, and nothing behind it reaches a page bundle.
 */
export async function createRunner(): Promise<EngineRunner> {
  const { createCanvasRunner } = await import('./canvas-runner')

  return createCanvasRunner()
}
