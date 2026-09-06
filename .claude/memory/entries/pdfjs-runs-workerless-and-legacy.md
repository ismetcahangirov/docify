---
name: "pdfjs-runs-workerless-and-legacy"
description: "pdf.js runs inside our worker only without its own worker and only as the legacy build — both are deliberate, not workarounds"
type: "decision"
date: "2026-08-14"
---

Decided implementing PDF page rendering (#41). Both halves look like
workarounds and are not; changing either re-breaks the engine in ways no test on
our side would catch.

**No pdf.js worker.** pdf.js normally spawns a module worker from
`GlobalWorkerOptions.workerSrc`. We run inside a worker already, so the reason
that worker exists — keeping parsing off the UI thread — is met by ours.
Nesting one costs uneven platform support with a dead-worker failure mode, plus
a bundler-placed URL, which is exactly the breakage class `vips-runtime.ts`
documents. Decisively, pdf.js's default path *cannot* run here at all:
`PDFWorker.#initialize` reads `window.location`, survives only because the block
sits in a `try`, and reaches its fake-worker path by accident. So the worker
module is imported alongside the API half and registered on
`globalThis.pdfjsWorker` — pdf.js's own supported hook, which wires both halves
over an in-process `LoopbackPort`.

Three worker-thread requirements come with that, each a crash otherwise: a
custom `CanvasFactory` (the default calls `document.createElement` for soft
masks, patterns, transparency groups and type-3 glyphs — most real PDFs), a
no-op `FilterFactory` (the browser one appends `<defs>` to `document.body`), and
`disableFontFace: true` (`document.fonts`).

**The legacy build.** pdfjs-dist 6.2's default build calls `Promise.try`,
`Uint8Array.prototype.toHex` and `Map.prototype.getOrInsertComputed` on ordinary
paths. All three are far newer than `OffscreenCanvas`, which is what
`descriptor.supports()` gates on — so a device that passes the gate would throw
a `TypeError` after a 1.8 MB download, with nothing left to route to. The legacy
build is the same library with those compiled away, costs ~108 kB more, and runs
wherever the descriptor promises it will. `PDFJS_LOAD_COST` is pinned to the
legacy sizes by a test.

Related: [[isolation-is-document-scoped]], [[cancel-needs-a-macrotask-yield]]
