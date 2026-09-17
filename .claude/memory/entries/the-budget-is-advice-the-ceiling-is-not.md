---
name: "the-budget-is-advice-the-ceiling-is-not"
description: "Two things refuse a large file and only one of them may be overruled — the memory budget is an estimate the user owns, the bitmap ceiling is a platform fact"
type: "decision"
date: "2026-09-17"
---

`fitsInBudget` is one function and two completely different claims, and issue #322 is
the discovery that they must not be refused the same way.

`peakBytes(...) <= budgetBytes(caps)` is an **estimate**, and `lib/router/budget.ts`
documents how rough: five of the ten `MEMORY` rows — `vips`, `remux`, `webcodecs`,
`ffmpeg`, `libarchive` — are not measured at all, `ffmpeg`'s 4.5 predates the engine
existing, and the canvas sweep found the byte factor 4.5x *over* on an incompressible
image. It reads that against `navigator.deviceMemory`, which is coarse, clamped to 0.25
at the low end and absent outside Chromium.

`fitsBitmapCeiling` is a **fact**. Past `MAX_CANVAS_PIXELS` a canvas returns a blank
surface rather than throwing.

The difference decides who may overrule what. An estimate about somebody's own tab is
advice, and `app/page.tsx` promises no limit on file size — so `RouteOptions
.allowOverBudget` lets a person who has read the refusal have the job anyway, and
`RouteRejection.overridable` is how the UI learns whether a way through exists. But a
button over the bitmap ceiling would buy a *silently wrong image*, which is worse than
the crash it is trading against, so `overBudgetRoute` filters on
`fitsBitmapCeiling` first and refuses when nothing survives. Same
`FILE_TOO_LARGE` code, opposite answer. A component reading the code rather than the
flag gets this wrong.

Two consequences that are not obvious from the call site:

- **The engine chosen changes.** While a job fits, the priority table ranks engines by
  how *well* they do it. Once nothing fits, the only question left is which candidate is
  least likely to take the tab down, so `cheapestFor` wins instead — deliberately the
  same engine `tooLarge` would have quoted a ceiling for, because a refusal naming one
  engine and an override running another is two answers to one question.
- **The worker must be told the raised number, on both axes.** `lib/engines/
  raster-limits.ts` bounds decoded pixels against `EngineInput.budgetBytes`. Hand it the
  device budget for an accepted job and it refuses a second time, inside the worker,
  after the download, to a user who has already been told it would be attempted — and
  that second refusal carries no `RejectionCode`, so it renders with no title, no button
  and no numbers tying it to the sentence they accepted. `grantedBytes()` exists for
  exactly that.

  The first attempt at it raised the allowance to the router's byte prediction alone and
  was wrong, which code review caught before merge. The two halves of the model charge
  different things: `MEMORY.vips` and `MEMORY.pdflib` carry `bytesPerPixel: 0` on
  purpose, while `assertPipelineFits` and `pdf-from-images` charge 8 bytes a *decoded
  pixel* against the same number. Rotating a 25 MB, 24 megapixel JPEG on a phone
  predicts 100 MB and measures 192 MB. The pixel term is therefore a term of the grant
  too, and `MAX_DECODED_BYTES_PER_PIXEL` lives in `budget.ts` rather than beside the
  guard that spends it, because `raster-limits.ts` already imports
  `DESKTOP_BUDGET_FLOOR_BYTES` from there and the constant going back would close an
  import cycle that fails as a `ReferenceError` at module init.

  It also cannot be unconditional, which is the part that looks like it should be. A
  24 megapixel photograph of 5 MB routes comfortably on bytes and still costs 192 MB
  decoded; that second bound is exactly what catches it, and raising the pixel
  allowance for every job would dissolve it. So `grantedBytes` takes the `RouteSuccess`
  and reads its own `OVER_BUDGET` warning — the decision rather than a flag a caller
  could mismatch.

The acceptance rides on the job (`QueuedJob.overBudget`) rather than on the `run()` call
because the scheduler sits between the button and the router and knows nothing about
why. It is deliberately not cleared by `retry`: a "Try again" that quietly went back to
refusing would make the user take the same decision twice for the same answer.

Related: [[router-gates-before-budget]], [[raster-ceilings-are-two-and-scoped]],
[[budget-is-affine-and-scoped]], [[no-server-side-processing]]
