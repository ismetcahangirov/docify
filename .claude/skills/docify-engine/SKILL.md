---
name: docify-engine
description: Use when adding or modifying a conversion engine in lib/engines/ — Canvas, wasm-vips, libheif, pdf-lib, pdf.js, WebCodecs, ffmpeg.wasm, fflate. Covers the EngineDescriptor contract, lazy loading, worker execution, progress/cancel, and the checklist for registering a new engine.
---

# Docify Conversion Engines

One engine = one file = `lib/engines/<id>.ts`.

## The contract

```ts
export interface EngineDescriptor {
  id: EngineId
  label: string          // shown to the user: "Hardware-accelerated (WebCodecs)"
  loadCost: number       // WASM/JS binary size in bytes — the router uses this
  priority: number       // lower = preferred
  supports(task: ConversionTask, caps: Capabilities): boolean
}

export interface EngineRunner {
  run(input: EngineInput, signal: AbortSignal, onProgress: (p: number) => void): Promise<Blob>
}
```

`EngineDescriptor` is **synchronous and tiny** — statically imported into `registry.ts`.
`EngineRunner` is **heavy** — loaded only via `dynamic import()`, only inside the worker.

This split is critical: the router must *know about* every engine without *loading* any of them.

```ts
// lib/engines/vips.ts

export const descriptor: EngineDescriptor = {
  id: 'vips',
  label: 'High-quality image processing',
  loadCost: 5_500_000,
  priority: 40,
  supports: (task, caps) =>
    IMAGE_FORMATS.has(task.from) &&
    IMAGE_FORMATS.has(task.to) &&
    caps.wasmSimd,
}

// The runner is loaded separately
export async function createRunner(): Promise<EngineRunner> {
  const Vips = (await import('wasm-vips')).default
  const vips = await Vips({ dynamicLibraries: [] })
  return { async run(input, signal, onProgress) { /* ... */ } }
}
```

## Checklist for adding an engine

- [ ] Create `lib/engines/<id>.ts` — export `descriptor` and `createRunner`
- [ ] Add the new id to the `EngineId` union (`lib/router/types.ts`)
- [ ] Add an expansion factor to `EXPANSION` in `lib/router/budget.ts` (**measure it, don't guess**)
- [ ] Register `descriptor` in `lib/engines/registry.ts`
- [ ] Slot `priority` between existing values
- [ ] Add a dynamic-import branch in `lib/worker/conversion.worker.ts`
- [ ] Add 2 router test cases: selected and not-selected
- [ ] Add a unit test for the engine itself, using a real small fixture file
- [ ] Run `pnpm size` and confirm the initial bundle did not grow

## Mandatory behaviours

### Lazy loading
```ts
// ✅
const { createRunner } = await import('./ffmpeg')
// ❌ — drops 32MB into the initial bundle
import { createRunner } from './ffmpeg'
```

### Cancellation
Every `run()` accepts an `AbortSignal` and **actually honours** it:
```ts
if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
signal.addEventListener('abort', () => ffmpeg.terminate())
```

### Progress
`onProgress(0..1)` must fire at least every 250 ms. Engines that cannot report progress (e.g. `pdflib` merge) emit `-1` for indeterminate mode.

### Memory hygiene
```ts
try { /* ... */ } finally {
  bitmap?.close()
  vipsImage?.delete()
  ffmpeg.deleteFile(inputName)
  URL.revokeObjectURL(url)
}
```
Without this the tab crashes after the user converts five files.

## Engine reference

| Engine | Library | Strength | Weakness |
|---|---|---|---|
| `canvas` | native | Zero download, instant | Weak quality control, drops EXIF |
| `heif` | libheif-js | HEIC decode | Decode only |
| `vips` | wasm-vips | Quality, AVIF/TIFF, metadata | 5.5 MB, requires SIMD |
| `pdflib` | pdf-lib | Structural ops, fast | Cannot render |
| `pdfjs` | pdf.js | Rendering, text extraction | Cannot edit |
| `webcodecs` | native + mp4box.js | **Hardware-accelerated**, streaming | Codec support varies by browser |
| `ffmpeg` | ffmpeg.wasm | Universal | 32 MB, 5–10× slower, memory hungry |
| `zip` | fflate | Small, fast | ZIP only |
| `libarchive` | libarchive.js | RAR/7z reading | No archive creation |

## WebCodecs specifics

Always check `VideoEncoder.isConfigSupported()` — `VideoEncoder` may exist while the specific codec is unsupported:

```ts
const support = await VideoEncoder.isConfigSupported({
  codec: 'avc1.42001f', width, height, bitrate,
})
if (!support.supported) throw new CodecUnavailableError()
```

That error surfaces to the router as `CODEC_UNAVAILABLE` and automatically triggers the `ffmpeg` fallback.
