---
name: "raster-ceilings-are-two-and-scoped"
description: "The raster pixel guard is two different ceilings over three engines — vips is deliberately exempt and canvas/heif deliberately get the browser limit, not the budget one"
type: "decision"
date: "2026-08-14"
---

#160 gave the raster engines a decoded-pixel guard. The non-obvious part is that
it is **two** ceilings and **three** of the four engines, and each exclusion was
a decision rather than an oversight.

**Why a ceiling in the engine at all.** A decoded bitmap costs
`width x height x 4` however well the file compressed. Twelve 1500x2000 PNGs
totalling 750 kB peak at 189 MB through `pdf-from-images` — 258x their input —
while the same pixel count as photographic grain is 1.8x. `route()` is handed
byte counts and never opens a file (CLAUDE.md §5.1), so no factor and no fixed
reserve in `lib/router/budget.ts` can describe that cost. The guard has to sit
beside the bytes it is decoding.

**Why two ceilings.** `assertDecodedPixelsFit` is budget-derived and applies to
`pdf-from-images` alone, because `embedPng` holds every image's samples
uncompressed until `save()`, so the cost accumulates across a job.
`assertBitmapFits` is a flat browser fact — 16 384 px a side, 67.1 Mpx — and
applies to `canvas` and `heif`, where the failure is a blank surface rather than
an OOM.

**Why canvas and heif do *not* get the budget ceiling.** The obvious structural
estimate (8 B/px against the conservative iOS budget) lands at 11.8 Mpx, which
is below a 4032x3024 iPhone photo. The HEIC engine would have refused the input
it exists to convert, on every device. Refusing the headline conversion on an
unmeasured constant is worse than the crash it prevents.

**Why vips is unguarded.** `newFromBuffer` with `access: 'sequential'` and
`thumbnailBuffer`'s shrink-on-load work in scanline regions and never
materialise the bitmap a ceiling would protect. That is also why `MEMORY.vips`
is 4 where `MEMORY.canvas` is 6.

The constant `PDFLIB_DECODED_BYTES_PER_PIXEL = 8` was set where it binds, not
averaged: pdf-lib costs ~32 MB before any pixel, so the marginal 4.96 B/px
between 9 and 18 Mpx is what reaches the 90 MB iOS budget at 12.05 Mpx. JPEG is
charged nothing — `embedJpg` never decodes — so a phone making a PDF of its
camera roll is untouched. Runs are in `docs/router/memory-budget-measurement.md`.

Related: [[budget-is-affine-and-scoped]], [[router-gates-before-budget]]
