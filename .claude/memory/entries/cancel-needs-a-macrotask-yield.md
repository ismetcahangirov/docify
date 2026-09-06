---
name: "cancel-needs-a-macrotask-yield"
description: "An engine loop that only awaits promises never observes a cancel — the worker's message loop needs a macrotask to run"
type: "gotcha"
date: "2026-08-14"
---

Found implementing PDF merge (#38), and it applies to every multi-item engine we
will ever ship.

Cancellation reaches the worker as a **message**: the main thread calls
`cancel(jobId)`, Comlink posts it, and the worker's `AbortController` fires only
once its message loop gets to run. An engine loop that awaits nothing but
promises — `await file.arrayBuffer()`, `await copyPages()` — stays entirely
inside the microtask queue, which the loop drains *before* handling any message.
So `signal.aborted` never becomes true, and a hundred-file merge runs to
completion after the user clicked Cancel.

Checking `signal.aborted` more often does not help. Nothing sets it.

The fix is a macrotask between items:

```ts
await new Promise<void>((resolve) => setTimeout(resolve, 0))
```

A timer yields to the loop; `Promise.resolve()`, `queueMicrotask` and
`await null` do not. Verified by mutation: remove the yield and the cancellation
test fails while every other test still passes — which is also the shape of test
that catches this, since an assertion on `signal.aborted` alone passes either
way.

This is the cooperative half of what `lib/worker/types.ts` already documents
about cancellation. That comment explains why an engine stuck in one synchronous
WASM call can only be stopped by killing the worker; this is the milder case,
where the engine *does* return to JavaScript regularly and still never hears the
abort.

Everything that processes N of something is exposed: `zip`, ffmpeg batches,
split-to-many, the video engines. `lib/engines/pdf-merge.ts` carries the
reference implementation.

Related: [[parallel-agent-coordination]], [[no-server-side-processing]]
