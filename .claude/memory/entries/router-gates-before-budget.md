---
name: router-gates-before-budget
description: The capability gate runs before the memory-budget check, so a rejection never quotes a doomed engine's ceiling
type: decision
date: 2026-08-13
---

`route()` in `lib/router/route.ts` runs its checks in this order: EMPTY_INPUT, candidate
lookup, **capability gate**, budget. The obvious order — budget first, since it is the
cheaper test — produces contradictory advice.

With budget first, a 900 MB video on a browser without WebCodecs is rejected FILE_TOO_LARGE
quoting the ffmpeg ceiling. The user does the work of shrinking the file to 400 MB, comes
back, and is now told CODEC_UNAVAILABLE — change your browser. The first rejection was true
but useless: that engine was never going to run. CLAUDE.md 2.5 requires a rejection to
explain itself, and an explanation that sends the user down a dead end fails that bar even
though every individual field is populated.

So viability is decided before capacity. A rejection may only quote the ceiling of an engine
that could actually have run.

The related shape this argues for, not yet built: `requires?(task)` on `EngineDescriptor`,
so each engine declares its own capability gate and the router stops naming engine ids in
`missingCapability`. Every engine added under the current shape makes that table harder to
unwind.

Decided in code review on issue #25; the brief given to the implementing agent had the
wrong order and the review caught it.

Related: [[isolation-is-document-scoped]], [[webcodecs-over-ffmpeg]]
