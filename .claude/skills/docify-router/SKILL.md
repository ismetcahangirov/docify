---
name: docify-router
description: Use when touching lib/router/ — the hybrid capability router that picks a conversion engine per job. Covers capability probing, memory budgets, engine ordering, rejection codes, and the required test matrix. Read before adding an engine, changing budgets, or debugging "wrong engine was selected".
---

# Docify Capability Router

The router is the heart of the project. A wrong decision means either a crashed browser tab or a conversion that runs 10× slower than it should.

## The unbreakable rule

**The router is a pure function.** `route(task, input, caps)` — never call `probeCapabilities()`, `navigator`, or `window` inside the module. `Capabilities` always arrives as a parameter.

Why: the entire selection logic must be testable without a browser, in milliseconds, fully deterministically.

```ts
// ✅ CORRECT — one size, or one size per file for a multi-file job
export function route(task: ConversionTask, input: RouteInput, caps: Capabilities): RouteResult

// ❌ WRONG — untestable, crashes during SSR
export function route(task: ConversionTask, input: RouteInput): RouteResult {
  const caps = probeCapabilities()  // forbidden
}
```

`RouteInput = number | readonly number[]`. `jobInput()` in `lib/router/job.ts` normalises the two into a `JobInput` — total, largest, smallest, count — and `isMeasurable()` is what turns "no files" or "one of them is empty" into `EMPTY_INPUT`.

## Decision sequence

```
1. no files, or any file with no bytes    → EMPTY_INPUT
2. engines where supports(task, caps)     → empty ? UNSUPPORTED_PAIR
3. sort by priority ASC, then loadCost ASC
4. capability gate                        → none viable ? CODEC_UNAVAILABLE
5. filter where fitsInBudget(id, job, caps)
6. none fit → FILE_TOO_LARGE (desktop) / DEVICE_TOO_WEAK (mobile)
7. first fitting engine wins → compute warnings
```

Steps 4 and 5 are in that order on purpose, and the order is load-bearing — see the `router-gates-before-budget` memory entry.

## Priority values (do not renumber, insert between)

| Priority | Engine | Rule |
|---:|---|---|
| 10 | `canvas` | Zero download — first choice wherever possible |
| 15 | `webcodecs` | Hardware-accelerated — always before ffmpeg for video |
| 20 | `pdflib` | |
| 25 | `pdfjs` | |
| 30 | `zip` | |
| 35 | `heif` | |
| 40 | `vips` | |
| 50 | `libarchive` | |
| 90 | `ffmpeg` | **Always last.** 32 MB download |

When adding an engine, slot its priority between existing values (e.g. 45). Never renumber the table.

## Memory budget

`lib/router/budget.ts` has two parts.

**Platform budget** — `budgetBytes(caps)`, the safe total memory for a tab:
- iOS: `90 MB` (Safari kills tabs early — do not raise this)
- Android: `140 MB`
- Desktop: `clamp(deviceMemory * 0.2, 140 MB, 1200 MB)`

The desktop floor matters: `navigator.deviceMemory` is absent outside Chromium and clamped to `0.25` at the low end, so the raw formula can derive `51 MB` — less than a phone gets. A desktop browser is not subject to the mobile tab-kill policies, so it never drops below the Android ceiling.

**Engine memory model** — `MEMORY[engine]`, three fields, all determined by **measurement** rather than guessing:

```
peak = factor × heldBytes + reserveBytes

heldBytes = holds === 'all-at-once' ? job.totalBytes : job.largestBytes
maxInput  = floor((budgetBytes(caps) − reserveBytes) / factor)   // maxInputBytes(engine, caps)
```

- `factor` — multiples of the bytes the engine has open. `ffmpeg` = 4.5 (input, output and scratch all live in MEMFS), `webcodecs` = 2.5 (streaming, never holds the whole file).
- `holds` — `'all-at-once'` when every file of a job is open together (merge builds one object graph out of all of them; a ZIP is written from every member), `'one-at-a-time'` when files are processed in turn. This is what makes a hundred 50 MB scans refusable while a hundred 8 MB images still route.
- `reserveBytes` — an allocation the input size does not predict: pdf.js sizes a page canvas from the requested DPI, so a 13 kB document still allocates 8.0 MB of RGBA. Taken off the top before the factor is applied.

Use `fitsInBudget(engine, job, caps)` for the filter step; it is inclusive of the limit. `docs/router/memory-budget-measurement.md` is the harness, and says which rows are measured and which are still carried over.

## Warnings

| Code | When |
|---|---|
| `SLOW_PATH` | `ffmpeg` was selected — no hardware acceleration available |
| `NO_ISOLATION` | `ffmpeg` + `crossOriginIsolated === false` → single-threaded |
| `LARGE_DOWNLOAD` | `loadCost > 8 MB` |
| `QUALITY_LOSS` | Lossy → lossy re-encode |

## Rejection responses

Both `message` **and** `suggestion` must be filled. `suggestion` must be a concrete action:

```ts
// ✅
suggestion: 'Open this on a desktop — mobile browsers have a much lower memory ceiling.'
// ❌
suggestion: 'Please try again.'
```

## Required test matrix

`lib/router/router.test.ts` must cover all of these:

```
✓ desktop + heic→jpg + 3MB                      → 'heif'
✓ desktop + jpg→png + 2MB                       → 'canvas'  (zero loadCost wins)
✓ desktop + mp4→webm + 50MB, webCodecs: true    → 'webcodecs'
✓ desktop + mp4→webm + 50MB, webCodecs: false   → 'ffmpeg' + SLOW_PATH
✓ ffmpeg + crossOriginIsolated: false           → NO_ISOLATION warning
✓ ios + mp4→mp3 + 200MB                         → DEVICE_TOO_WEAK
✓ desktop + mp4→mp3 + 4GB                       → FILE_TOO_LARGE
✓ jpg→dwg                                       → UNSUPPORTED_PAIR
✓ input: 0                                      → EMPTY_INPUT
✓ two engines support the task                  → lower priority wins
✓ equal priority                                → lower loadCost wins
✓ vips loadCost 5.5MB                           → no LARGE_DOWNLOAD (below the 8MB threshold)
```

Plus, for multi-file jobs:

```
✓ merge, 100 x 50MB, desktop                    → FILE_TOO_LARGE quoting the 4.9GB total
✓ jpg→png, 300 x 100MB, desktop                 → 'canvas' (only the largest file has to fit)
✓ input: []                                     → EMPTY_INPUT
✓ input: [2MB, 0, 2MB]                          → EMPTY_INPUT naming the count
✓ input: [3MB]                                  → identical to input: 3MB
```

Every new engine must add at least **two** cases to this matrix: one where it is selected, one where it is not.

## Common mistakes

- **Using `await` in the router** — the router is synchronous and performs no I/O
- **Reading the file inside `supports()`** — decisions come from `task` and `caps` only
- **Raising a budget "to make it work"** — an OOM kills the user's tab, which is worse than an honest error message
- **Hardcoding an engine in the UI** — always call `route()`
