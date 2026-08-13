<div align="center">

# Docify

**Convert any file — entirely in your browser.**

No sign-up. No upload. No limits imposed by someone else's server.

[![CI](https://github.com/ismetcahangirov/docify/actions/workflows/ci.yml/badge.svg)](https://github.com/ismetcahangirov/docify/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-black.svg)](LICENSE)
[![Next.js](https://img.shields.io/badge/Next.js-15-black)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-black)](https://www.typescriptlang.org)

</div>

---

## What it is

Docify is a free, open file conversion tool. Images, PDFs, audio, video and archives — converted, compressed and edited **on your own device**.

Every other online converter works the same way: you upload your file to their servers, they process it, you download the result. That means your files sit on someone else's disk, you wait in a queue, and you hit a paywall the moment your file gets large.

Docify does none of that. The conversion engines run inside your browser as WebAssembly and WebCodecs. **Your file never leaves your device** — not because we promise it, but because there is no server to send it to.

## Why it's different

|  | Typical online converter | Docify |
|---|---|---|
| Where files are processed | Their servers | **Your device** |
| File upload required | Yes | **No** |
| Account required | Usually | **No** |
| Daily conversion limit | Yes (minutes/quota) | **No** |
| Hardware acceleration | Paid tier only | **Free, always** |
| Works offline | No | **Yes**, after first load |
| Privacy | Depends on their policy | **Structurally guaranteed** |

## Features

**Images** — HEIC, WEBP, AVIF, PNG, JPG, TIFF, BMP, GIF, SVG · convert · compress · resize · crop · rotate · EXIF control

**PDF** — merge · split · rotate · reorder · delete pages · PDF → image · image → PDF · password protect / remove · extract text

**Video & Audio** — MP4, WEBM, MOV, MKV, AVI · MP3, WAV, OGG, M4A, FLAC · convert · compress · extract audio · video → GIF · remux

**Archives** — ZIP create and extract · RAR / 7z extract

## How it works

```
                       ┌──────────────────────────────────────┐
   Your file ─────────▶│  Hybrid Capability Router            │
   (never uploaded)    │                                      │
                       │  1. Probe device capabilities        │
                       │  2. Compute a safe memory budget     │
                       │  3. Pick the fastest usable engine   │
                       └───────────────┬──────────────────────┘
                                       │
             ┌─────────────┬───────────┼───────────┬─────────────┐
             ▼             ▼           ▼           ▼             ▼
         WebCodecs      Canvas     wasm-vips    pdf-lib     ffmpeg.wasm
       (GPU-accelerated) (instant)  (quality)   (structural) (universal fallback)
             │             │           │           │             │
             └─────────────┴───────────┴─────┬─────┴─────────────┘
                                             ▼
                                   Result, in your browser
```

The **router** is the core of Docify. Instead of shipping one heavy engine and using it for everything, it measures what your device can actually do — hardware video encoding, SIMD, available memory, cross-origin isolation — and routes each job to the cheapest engine that can handle it. A HEIC photo takes a few hundred kilobytes of code. A 4K video transcode uses your GPU through WebCodecs. Only when nothing else fits does it fall back to the full FFmpeg build.

If a file genuinely can't be handled on your device, Docify tells you exactly why and what to do about it — never a generic "conversion failed".

## Tech stack

| Layer | Technology |
|---|---|
| Framework | Next.js 15 (App Router), React 19, TypeScript |
| Styling | Tailwind CSS v4, shadcn/ui |
| Image | wasm-vips, libheif-js, Canvas / OffscreenCanvas |
| PDF | pdf-lib, pdf.js |
| Video / Audio | WebCodecs + mp4box.js, ffmpeg.wasm |
| Archives | fflate, libarchive.js |
| Concurrency | Web Workers via Comlink |
| Testing | Vitest, Testing Library, Playwright |
| Data | Neon (Postgres) — anonymous aggregate counters only |
| Hosting | Vercel (app), Render (URL import proxy) |

## Getting started

**Requirements:** Node.js 22+, pnpm 9+

> Node 22 is required because the repository's agent tooling uses the built-in `node:sqlite` module. The application itself runs on Node 20+.

```bash
git clone https://github.com/ismetcahangirov/docify.git
cd docify
pnpm install
pnpm dev
```

Open http://localhost:3000

### Scripts

```bash
pnpm dev          # development server
pnpm build        # production build
pnpm test         # unit tests
pnpm e2e          # end-to-end tests
pnpm lint         # lint
pnpm typecheck    # type check
pnpm size         # bundle budget check
```

### Environment variables

All optional — the app is fully functional without them.

```bash
DATABASE_URL=              # Neon connection string (anonymous counters)
NEXT_PUBLIC_PROXY_URL=     # URL-import proxy endpoint
```

## Project structure

```
app/           Next.js routes, programmatic SEO pages, metadata
components/    ui/ (shadcn) · marketing/ · converter/
lib/
  router/      capability probe, memory budget, engine selection
  engines/     one file per conversion engine
  registry/    formats, tools, conversion pairs (SEO source of truth)
  worker/      Web Worker bridge
  seo/         metadata and JSON-LD generators
services/      url-proxy (Render)
docs/          architecture and implementation plans
```

## Privacy

Docify has no accounts, no cookies for tracking, and no file storage. The only data that ever reaches a server is an anonymous counter event recording *which conversion type* was performed and whether it succeeded — no file names, no file contents, no IP addresses retained.

## Contributing

Contributions are welcome.

1. Pull the latest `main`
2. Create a branch: `feat/<issue>-<slug>` (see [CLAUDE.md](CLAUDE.md) for the full convention)
3. Follow TDD — tests first
4. Make sure CI is green
5. Open a PR referencing the issue with `Closes #N`

Architecture decisions and design constraints are documented in [CLAUDE.md](CLAUDE.md) and `docs/`.

## Roadmap

- [ ] Core capability router and engine registry
- [ ] Image engines (Canvas, libheif, wasm-vips)
- [ ] PDF engines (pdf-lib, pdf.js)
- [ ] Video engines (WebCodecs, ffmpeg.wasm fallback)
- [ ] Converter UI with queue, progress and cancellation
- [ ] Programmatic SEO pages for 120+ conversion pairs
- [ ] Offline support (PWA)
- [ ] Batch processing and presets

## License

MIT © [ismetcahangirov](https://github.com/ismetcahangirov)
