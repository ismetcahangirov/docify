---
name: docify-router
description: Use when touching lib/router/ — the hybrid capability router that picks a conversion engine per job. Covers capability probing, memory budgets, engine ordering, rejection codes, and the required test matrix. Read before adding an engine, changing budgets, or debugging "wrong engine was selected".
---

# Docify Capability Router

The router is the heart of the project. A wrong decision means either a crashed browser tab or a conversion that runs 10× slower than it should.

## The unbreakable rule

**The router is a pure function.** `route(task, inputBytes, caps)` — never call `probeCapabilities()`, `navigator`, or `window` inside the module. `Capabilities` always arrives as a parameter.

Why: the entire selection logic must be testable without a browser, in milliseconds, fully deterministically.

```ts
// ✅ CORRECT
export function route(task: ConversionTask, inputBytes: number, caps: Capabilities): RouteResult

// ❌ WRONG — untestable, crashes during SSR
export function route(task: ConversionTask, inputBytes: number): RouteResult {
  const caps = probeCapabilities()  // forbidden
}
```

## Decision sequence

```
1. inputBytes <= 0                          → EMPTY_INPUT
2. engines where supports(task, caps)       → empty ? UNSUPPORTED_PAIR
3. sort by priority ASC, then loadCost ASC
4. filter where inputBytes <= maxInputBytes(id, caps)
5. none fit → FILE_TOO_LARGE (desktop) / DEVICE_TOO_WEAK (mobile)
6. first fitting engine wins → compute warnings
```

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

**Expansion factor** — how many multiples of the input size the engine holds in RAM. For a new engine, determine this by **measurement**, not by guessing:

```
maxInput = budgetBytes(caps) / EXPANSION[engine]     // maxInputBytes(engine, caps)
```

Use `fitsInBudget(engine, inputBytes, caps)` for the filter step; it is inclusive of the limit.

`ffmpeg` = 4.5 (input + output + working memory all live in MEMFS), `webcodecs` = 2.5 (streaming, never holds the whole file).

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
✓ inputBytes: 0                                 → EMPTY_INPUT
✓ two engines support the task                  → lower priority wins
✓ equal priority                                → lower loadCost wins
✓ vips loadCost 5.5MB                           → no LARGE_DOWNLOAD (below the 8MB threshold)
```

Every new engine must add at least **two** cases to this matrix: one where it is selected, one where it is not.

## Common mistakes

- **Using `await` in the router** — the router is synchronous and performs no I/O
- **Reading the file inside `supports()`** — decisions come from `task` and `caps` only
- **Raising a budget "to make it work"** — an OOM kills the user's tab, which is worse than an honest error message
- **Hardcoding an engine in the UI** — always call `route()`
