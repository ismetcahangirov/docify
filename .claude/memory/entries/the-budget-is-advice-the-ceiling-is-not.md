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
- **The worker must be told the raised number.** `lib/engines/raster-limits.ts` bounds
  decoded pixels against `EngineInput.budgetBytes`. Hand it the device budget for an
  accepted job and it refuses a second time, inside the worker, after the download, to a
  user who has already been told it would be attempted. `grantedBytes()` exists for
  exactly that and needs no "was this overridden" flag: for any normally-accepted job
  the peak is at or under the budget by definition, so it *is* `budgetBytes(caps)`
  everywhere except the path that raised it.

The acceptance rides on the job (`QueuedJob.overBudget`) rather than on the `run()` call
because the scheduler sits between the button and the router and knows nothing about
why. It is deliberately not cleared by `retry`: a "Try again" that quietly went back to
refusing would make the user take the same decision twice for the same answer.

Related: [[router-gates-before-budget]], [[raster-ceilings-are-two-and-scoped]],
[[budget-is-affine-and-scoped]], [[no-server-side-processing]]
