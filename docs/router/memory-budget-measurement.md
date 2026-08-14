# Measuring the router's memory budget

`MEMORY` in `lib/router/budget.ts` decides how large a job each engine may accept:

```
peak = factor × heldBytes + reserveBytes
```

where `heldBytes` is the whole job for an engine that opens every file at once
(`holds: 'all-at-once'`) and the largest single file for one that works through
them in turn (`holds: 'one-at-a-time'`).

Every number in that table is supposed to have been measured. This is how, and
what came out. Re-run it whenever an engine changes, a dependency is upgraded, or
a number here looks wrong — the harness is committed precisely so that the next
person does not have to take the table on trust.

## Running it

```bash
node docs/router/memory-budget.mjs corpus  /tmp/docify-corpus   # ~700 MB, deterministic
node docs/router/memory-budget.mjs measure /tmp/docify-corpus   # every scenario, ~4 minutes
node --expose-gc docs/router/memory-budget.mjs measure /tmp/docify-corpus merge-scan-30
```

`measure` with no scenario forks one child process per scenario, so a leak in one
cannot inflate the next. A single scenario needs `--expose-gc` itself, because the
baseline is taken after a forced collection.

The corpus is generated from a seeded PRNG, so two people on two machines build
byte-identical inputs. Nothing is committed: 700 MB of synthetic PDFs in git would
be worse than a script that rebuilds them in ninety seconds.

## The corpus

110 files, 714 471 757 bytes.

| Group | What it is | Why |
| --- | --- | --- |
| `vector-000..029.pdf` | 8 pages of Helvetica, ~13 kB each | Reports and invoices: tiny files, large object graphs |
| `scan-000..029.pdf` | 4 pages, one 1224 × 1584 bitmap each, ~15 MB | Photographed paperwork — what a hundred-file merge is made of |
| `scan-large.pdf` | 20 scanned pages, 78 MB | The single big document |
| `vector-large.pdf` | 200 text pages, 0.3 MB | Page count without bytes |
| `photo-000..023.jpg` | 4000 × 3000, 2.4 MB each | Camera output, for images → PDF |
| `shot-000..011.png` | 1500 × 2000 of grain, 9 MB each | A photograph saved as PNG |
| `flat-000..011.png` | 1500 × 2000 of gradient, 64 kB each | A screenshot: same pixels, a hundredth of the bytes |

Two deliberate compromises, both of which change what a result means:

- **The JPEGs carry a real frame header and padded filler, not entropy-coded scan
  data.** pdf-lib never runs a Huffman decoder — it reads SOF0 for the dimensions
  and copies the bytes into a `DCTDecode` stream — so its memory depends on the
  byte length and nothing else, which padding reproduces exactly. Anything that
  actually decodes JPEG (pdf.js, a canvas) must not be pointed at these, which is
  why the scanned PDFs embed PNG instead.
- **The scans are synthetic.** Their compression ratio (~3:1) and page geometry
  match a 150 dpi colour scan, which is what the factor depends on. The pixel
  content does not matter to any allocation being measured.

## What Node can and cannot measure

pdf-lib and pdf.js are plain JavaScript and run here unchanged. `canvas`, `vips`
and `heif` are browser APIs and WASM modules with no Node equivalent, so **their
factors were not re-measured in this pass** and remain at their earlier values.
Measuring them needs a Playwright harness on a cross-origin-isolated page driving
`performance.measureUserAgentSpecificMemory()`; that is a separate piece of work
and is not pretended to have been done here.

Two adjustments are applied to every Node number before it is compared to the
model:

1. **The `Blob` copy.** `EngineRunner.run` answers with a `Blob`, and constructing
   one copies the bytes. Node's peak covers the serialised `Uint8Array` only, so
   the browser peak is `peakLiveBytes + outputBytes`. For merge and organise the
   output is roughly the size of the input, which is a whole extra `1×`.
2. **Run-to-run variance.** Peaks move by 10–20% between runs because they depend
   on when V8 collects. Numbers below are from one run; the conservative end of
   two runs is what the table in `budget.ts` was set from.

## Results

Measured 2026-08-14, Node 22.16.0, Windows 11, `--max-old-space-size=4096`.
`peak` is `heapUsed + external` above a post-GC baseline.

| Scenario | Files | Input MB | Peak MB | Peak/in | + Blob copy |
| --- | ---: | ---: | ---: | ---: | ---: |
| `merge-vector-30` | 30 | 0.4 | 10.1 | 27.0 | 27.9 |
| `merge-scan-30` | 30 | 447.4 | 852.8 | 1.91 | **2.91** |
| `merge-mixed-60` | 60 | 447.8 | 855.8 | 1.91 | **2.91** |
| `merge-vector-100` | 100 | 1.2 | 25.0 | 20.1 | 21.1 |
| `images-jpg-24` | 24 | 54.9 | 95.5 | 1.74 | **2.74** |
| `images-png-12` | 12 | 103.0 | 184.1 | 1.79 | **2.79** |
| `images-mixed-36` | 36 | 158.0 | 318.2 | 2.01 | **3.01** |
| `images-flat-png-12` | 12 | 0.7 | 192.0 | **261.6** | 262.6 |
| `organize-scan-large` | 1 | 74.6 | 151.7 | 2.03 | **3.03** |
| `organize-vector-large` | 1 | 0.3 | 15.6 | 53.0 | 54.0 |
| `split-scan-large` | 1 | 74.6 | 224.8 | 3.02 | **4.02** |
| `split-vector-large` | 1 | 0.3 | 49.6 | 168.9 | 170.4 |
| `pdfjs-scan-large` | 1 | 74.6 | 77.1 – 159.0 | 1.03 – 2.03 | n/a |
| `pdfjs-vector-large` | 1 | 0.3 | 33.4 | 113.8 | n/a |
| `pdfjs-vector-small` | 1 | 0.013 | 17.8 | 1438.6 | n/a |

### What the numbers say

**`pdflib` — `factor: 4`, `holds: 'all-at-once'`, `reserveBytes: 32 MB`.**

The bytes-proportional term is the bold column: merge and images → PDF settle at
2.7–3.0×, organise at 3.0×, and split at 4.0× because it holds every produced
page document until the archive is packed. 4 is the worst of the four operations
and one number has to cover all of them, since the table is keyed by engine.

`all-at-once` is not a judgement call. `merge-scan-30` and `merge-mixed-60` differ
by 30 files and 0.4 MB and peak within 3 MB of each other: the cost tracks the
total, not the count and not the largest member. A hundred 50 MB scans is 4.9 GB
by this model and is refused, which was the point of the issue.

The 32 MB reserve is what pdf-lib costs before the input is considered.
`merge-vector-100` peaks at 25 MB on 1.2 MB of input, and `split-vector-large` at
50 MB on 0.3 MB. `4 × 1.2 MB + 32 MB` covers the first. It does not cover the
second, and that is a deliberate under-prediction: 50 MB is comfortably inside
every platform budget, so being wrong there cannot kill a tab, while a reserve
large enough to cover it would cost every merge on a phone half its allowance.
The under-prediction grows with page count, which the router cannot see —
see below.

**`pdfjs` — `factor: 4`, `holds: 'one-at-a-time'`, `reserveBytes: 32 MB`.**

Parsing alone measured at 1.0–2.0× the document. The engine then renders each
selected page, holds the encoded result until every page is done, and packs the
lot into a ZIP — roughly another 2× for a scanned document, hence 4.

The reserve is the half no factor can express, and it is the case the issue was
opened for. A page canvas is `width × height × 4`, sized from the requested DPI
and not from the file: a US Letter page at the default 150 dpi is
1275 × 1650 × 4 = 8.4 MB whether it came from a 1.4 kB vector document or a 50 MB
scan. `pdfjs-vector-small` shows the same shape from the other side — 13 kB of
input, 17.8 MB of pdf.js. 32 MB covers the canvas, the encoded copy taken off it,
and the 18–37 MB baseline measured for opening a document at all.

`MAX_CANVAS_PIXELS` and `MAX_RENDER_DPI` in `lib/engines/pdf-render-plan.ts` are
what keep that reserve honest at the top end: without them a page could ask for
268 MB of canvas and the reserve would be fiction.

## What the model still cannot see

`images-flat-png-12` is the row to read twice. Twelve screenshots totalling
**750 kB** peak at **192 MB** — 262× their input — because pdf-lib decodes a PNG
to raw RGB before it re-compresses it, and a decoded bitmap is
`width × height × 4` however well the file compressed. The identical pixel count
as grain (`images-png-12`) is 103 MB of input for 184 MB of peak, or 1.8×.

No input-size-relative factor can describe both rows, and no fixed reserve can
either, because the cost scales with the number of images. The router is handed
byte counts and cannot know a pixel count, so **this bound cannot be enforced in
`lib/router/`.** It belongs to the engine, next to the bytes it is decoding —
the same shape as `canvasSize()` in `pdf-render-plan.ts`, which refuses a page
before it allocates it.

The same hole is open in three other places:

- `canvas`, `vips` and `heif` decode raster input and are bound by pixels for
  exactly the same reason. Their factors describe photographic content, where
  file size and pixel count correlate, and understate a flat PNG by two orders of
  magnitude.
- `pdf-split` holds one `PDFDocument` per page until the archive is written, so
  its cost scales with page count. `split-vector-large` is 200 pages of 0.3 MB
  peaking at 50 MB.
- `pdf-render` accumulates every encoded page for the same reason.

None of those are things the router can fix, and none of them are papered over
with a factor here that would look measured and not be.
