/**
 * The size past which a browser canvas stops being a canvas.
 *
 * Safari refuses a surface larger than {@link MAX_CANVAS_SIDE} on either axis,
 * and every browser caps total area independently of that. Exceeding either
 * yields a *blank* surface rather than an exception — the conversion
 * "succeeds" and the user downloads an empty image — so both consumers check
 * before anything is allocated.
 *
 * ## Why this is its own module
 *
 * Two engines need these numbers and they must not disagree. `pdf-render-plan`
 * reached them first, for a page it is about to rasterise; `raster-limits`
 * needs the same bound for an `ImageBitmap` the Canvas engine is about to
 * decode. Importing the former from the latter is what #160 declined to do,
 * and its reason was right: `pdf-render-plan` drags the whole pdf.js
 * page-planning graph behind it, and the Canvas engine's entire point is that
 * it downloads nothing (CLAUDE.md §2.3).
 *
 * So the numbers live in a leaf instead. This module imports nothing — not a
 * type, not a sibling — which is what makes sharing it free for both, and
 * `test/engines/canvas-limits.test.ts` holds that line: it asserts the graph
 * reachable from here is empty, and that no other engine module assigns either
 * literal.
 *
 * ## Why not the memory budget
 *
 * This is a factual bound, not a budget. What a decoded bitmap plus its canvas
 * actually costs has never been measured, and a ceiling derived from an
 * estimated per-pixel cost against a deliberately conservative budget would
 * refuse a 12 megapixel phone photo — the single commonest input the app has.
 * `lib/engines/raster-limits.ts` states the full argument, and
 * `docs/router/memory-budget-measurement.md` is the measurement that has not
 * been made.
 */

/** Safari's per-axis ceiling, which is the strictest of the mainstream ones. */
export const MAX_CANVAS_SIDE = 16_384

/** Total area, capped independently of the axes. 8192², i.e. 67.1 megapixels. */
export const MAX_CANVAS_PIXELS = 67_108_864
