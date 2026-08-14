---
name: budget-is-affine-and-scoped
description: The memory budget is factor x heldBytes + reserveBytes, and each engine says whether it holds every file of a job at once or one at a time
type: decision
date: 2026-08-14
---

`MEMORY` in `lib/router/budget.ts` replaced the old `EXPANSION: Record<EngineId, number>`
in issue #155. A single multiple of the input size could not express two real shapes of
job, and both were already shipping.

**Multi-file.** `route()` took one scalar, so `pdf-merge`'s only ceiling was
`MAX_MERGE_FILES` — a count, not a size. A hundred 50 MB scans passed every router check
and then exhausted the tab. `holds: 'all-at-once' | 'one-at-a-time'` is the fix: merge and
the ZIP engine are budgeted on the job's total, every raster engine on its largest single
file. Measured, not assumed — merging 30 scans and merging the same 30 plus 30 tiny vector
PDFs peak within 3 MB of each other, so the cost tracks the total and not the count.

**Resolution-bound.** pdf.js sizes a canvas from the requested DPI, so a 13 kB document
allocates 8.0 MB of RGBA at 150 dpi and pdf.js itself costs 17.8-34.4 MB to open anything
at all. No input-relative factor fits both that and a 78 MB scan. `reserveBytes` is the affine
term for exactly this, taken off the device budget before the factor is applied.

Why the table stayed keyed by `EngineId` in `budget.ts` rather than moving onto
`EngineDescriptor`: four of the nine ids have no descriptor yet. `Record<EngineId, ...>`
makes a missing model a compile error; a descriptor field would make it a silent default on
the day that engine ships.

**What the model still cannot see, and deliberately does not pretend to.** A decoded bitmap
is `width x height x 4` however well the source compressed. Twelve flat-coloured PNGs
totalling 750 kB peak at 189 MB through pdf-lib — 258x. The router is handed byte counts
and cannot know a pixel count, so this bound has to live in the engine, beside the bytes it
is decoding, the way `canvasSize()` already does in `pdf-render-plan.ts`. The same hole is
open for `canvas`, `vips`, `heif`, and for `pdf-split`, which holds one `PDFDocument` per
page until the archive is written. Tracked as issue #160.

The corpus, the harness and every number are in `docs/router/memory-budget-measurement.md`;
re-run it rather than trusting the table. `canvas`, `vips`, `heif`, `webcodecs`, `ffmpeg` and `libarchive` were **not**
measured — they need a browser harness driving
`performance.measureUserAgentSpecificMemory()` on an isolated page.

Related: [[router-gates-before-budget]], [[no-server-side-processing]]
