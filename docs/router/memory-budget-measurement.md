# Measuring the router's memory budget

`MEMORY` in `lib/router/budget.ts` decides how large a job each engine may accept:

```
peak = factor × heldBytes + reserveBytes
```

where `heldBytes` is the whole job for an engine that opens every file at once
(`holds: 'all-at-once'`) and the largest single file for one that works through
them in turn (`holds: 'one-at-a-time'`).

This is where those numbers came from, which of them are measured, and which are
not. Re-run it whenever an engine changes, a dependency is upgraded, or a number
looks wrong — the harness is committed precisely so the next person does not have
to take the table on trust.

## Running it

```bash
node docs/router/memory-corpus.mjs  /tmp/docify-corpus   # ~700 MB, ~90 seconds
node docs/router/memory-measure.mjs /tmp/docify-corpus   # every scenario, ~4 minutes
node --expose-gc docs/router/memory-measure.mjs /tmp/docify-corpus merge-scan-30
```

`memory-measure.mjs` with no scenario forks one child process per scenario, so a
leak in one cannot inflate the next and a scenario that runs out of heap costs
only its own row. A single scenario needs `--expose-gc` itself, because the
baseline is taken after a forced collection.

The corpus is generated from a seeded PRNG. Sizes are reproducible to the byte;
the PDF bytes themselves are not, because pdf-lib stamps a `CreationDate` on
every document it writes.

## The corpus

110 files, 714 471 728 bytes.

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

## What is measured here and what is not

| Engine | Status |
| --- | --- |
| `pdflib` | **Measured**, four operations, below |
| `zip` | **Measured** through `fflate` directly, which is what the engine will be built on |
| `pdfjs` | **Half measured.** Parsing runs in Node; rendering needs a canvas, so the render term is an estimate — see below |
| `canvas`, `vips`, `heif` | **Not measured.** Browser APIs and WASM modules with no Node equivalent; their factors are unchanged from before this document existed |
| `webcodecs`, `ffmpeg`, `libarchive` | **Not measured.** No engine ships yet, and none of the three has a Node stand-in worth measuring. Their factors and `holds` values are carried over and are as good as the guess that produced them |

Measuring the browser engines needs a Playwright harness on a cross-origin-isolated
page driving `performance.measureUserAgentSpecificMemory()`. That is a separate
piece of work and is not pretended to have been done here.

Two adjustments apply to every Node number before it is compared to the model:

1. **The `Blob` copy.** `EngineRunner.run` answers with a `Blob`, and constructing
   one copies the bytes. Node's peak covers the serialised `Uint8Array` only, so
   the browser peak is `peakLiveBytes + outputBytes` — the `peak+blob/in` column
   the harness prints, and the column the factors were set from.
2. **Run-to-run variance.** Peaks move with when V8 collects. Two full runs are
   recorded below rather than one, and the model was set from the worse of them.

## Results

Measured 2026-08-14, Node 22.16.0, Windows 11, `--max-old-space-size=4096`.
`peak` is `heapUsed + external` above a post-GC baseline. Two consecutive runs of
the same corpus.

| Scenario | Files | Input MB | Peak MB (run 1 / run 2) | peak+blob/in (run 1 / run 2) |
| --- | ---: | ---: | ---: | ---: |
| `merge-vector-30` | 30 | 0.4 | 10.2 / 10.2 | 28.4 / 28.3 |
| `merge-scan-30` | 30 | 447.4 | 853.0 / 852.8 | **2.91 / 2.91** |
| `merge-mixed-60` | 60 | 447.8 | 855.8 / 855.8 | **2.91 / 2.91** |
| `merge-vector-100` | 100 | 1.2 | 24.8 / 25.7 | 20.9 / 21.6 |
| `images-jpg-24` | 24 | 54.9 | 95.5 / 95.5 | **2.74 / 2.74** |
| `images-png-12` | 12 | 103.0 | 184.1 / 184.1 | **2.79 / 2.79** |
| `images-mixed-36` | 36 | 158.0 | 318.2 / 318.2 | **3.01 / 3.01** |
| `images-flat-png-12` | 12 | 0.7 | 160.2 / 188.9 | **219 / 258** |
| `organize-scan-large` | 1 | 74.6 | 151.7 / 151.7 | **3.03 / 3.03** |
| `organize-vector-large` | 1 | 0.3 | 15.7 / 15.6 | 54.4 / 54.1 |
| `split-scan-large` | 1 | 74.6 | 225.0 / 224.8 | **4.02 / 4.02** |
| `split-vector-large` | 1 | 0.3 | 43.7 / 39.3 | 150.6 / 135.4 |
| `archive-scan-30` | 30 | 447.4 | 864.0 / 864.0 | **2.93 / 2.93** |
| `archive-vector-30` | 30 | 0.4 | 0.9 / 0.9 | **3.42 / 3.42** |
| `pdfjs-scan-large` | 1 | 74.6 | 77.1 / 77.1 | 1.03 / 1.03 (parse only) |
| `pdfjs-vector-large` | 1 | 0.3 | 33.4 / 34.4 | (parse only) |
| `pdfjs-vector-small` | 1 | 0.013 | 17.8 / 17.8 | (parse only) |

### `pdflib` — `factor: 4`, `holds: 'all-at-once'`, `reserveBytes: 32 MB`

The proportional term is the bold column: merge and images → PDF settle at
2.7–3.0×, organise at 3.0×, and split at 4.0× because it holds every produced
page document until the archive is packed. 4 is the worst of the four operations,
and one number has to cover all of them, since the table is keyed by engine.

`all-at-once` is not a judgement call. `merge-scan-30` and `merge-mixed-60` differ
by 30 files and 0.4 MB and peak within 3 MB of each other: the cost tracks the
total, not the count and not the largest member. A hundred 50 MB scans is 4.9 GB
by this model and is refused, which was the point of the issue.

The 32 MB reserve is what pdf-lib costs before the input is considered.
`merge-vector-100` peaks at 25.7 MB on 1.2 MB of input, `organize-vector-large` at
15.7 MB on 0.3 MB, and `split-vector-large` at 43.7 MB on 0.3 MB.
`4 × 1.2 MB + 32 MB` covers the first two.

It does **not** cover the third, and that is deliberate. Splitting a 200-page
document costs by page count, which the router cannot see, and the model
under-predicts it by 10 MB. Covering it would need a 48 MB reserve, which would
drop an iPhone's whole-job merge ceiling from 14.5 MB to 10.5 MB — a real cost on
the common case to describe a peak of 44 MB that is already comfortably inside
every platform budget. Under-prediction that cannot reach the ceiling cannot kill
a tab; the same under-prediction on a 2000-page document could, which is what the
follow-up in "what the model still cannot see" is for.

### `pdfjs` — `factor: 4`, `holds: 'one-at-a-time'`, `reserveBytes: 32 MB`

**The factor is part measurement and part estimate, and should be treated as
provisional.** Parsing a 78 MB scan — opening the document and turning every
page's content stream into drawing operations — measured at 1.03× its bytes. The
render itself cannot run here: there is no canvas in Node, so the harness stops
at `getOperatorList()`. The remaining 3× is an estimate of what
`lib/engines/pdf-render.ts` adds on top: the encoded PNG or JPEG of every
selected page held until the last one is done, the ZIP built from all of them,
and the `Blob` copy of that. For a scanned document each of those three is close
to the size of the input, which is where the number comes from. Re-measure it
with a browser harness before treating it as fact.

The reserve is the half no factor can express, and it is the case the issue was
opened for. A page canvas is `width × height × 4`, sized from the requested DPI
and not from the file: a US Letter page at the default 150 dpi is
1275 × 1650 × 4 = 8.0 MB whether it came from a 13 kB vector document or a 78 MB
scan. `pdfjs-vector-small` shows the same shape from the other side — 13 kB of
input, 17.8 MB of pdf.js. 32 MB covers that canvas, the encoded copy taken off
it, and the 17.8–34.4 MB measured for opening a document at all.

`MAX_CANVAS_PIXELS` and `MAX_RENDER_DPI` in `lib/engines/pdf-render-plan.ts` are
what keep that reserve honest at the top end: without them a page could ask for
256 MB of canvas and the reserve would be fiction.

### `zip` — `factor: 3`, `holds: 'all-at-once'`

`fflate`'s `zipSync` is handed every member and builds the archive in one buffer,
so an archive job costs what its members add up to. Measured at 2.93× on 447 MB of
input and 3.42× on a job small enough for fflate's own working set to show, both
including the `Blob` copy. The engine itself does not exist yet; this measures the
library it will be built on, which is also what `lib/engines/zip-output.ts`
already uses.

## What the model still cannot see

`images-flat-png-12` is the row to read twice. Twelve screenshots totalling
**750 kB** peak at **189 MB** — 258× their input — because pdf-lib decodes a PNG
to raw RGB before it re-compresses it, and a decoded bitmap is
`width × height × 4` however well the file compressed. The identical pixel count
as grain (`images-png-12`) is 103 MB of input for 184 MB of peak, or 1.8×.

No input-size-relative factor can describe both rows, and no fixed reserve can
either, because the cost scales with the number of images. The router is handed
byte counts and cannot know a pixel count, so **this bound cannot be enforced in
`lib/router/`.** It belongs to the engine, next to the bytes it is decoding — the
same shape as `canvasSize()` in `pdf-render-plan.ts`, which refuses a page before
it allocates it. Tracked as **issue #160**.

The same hole is open in four other places, none of them papered over with a
factor here that would look measured and not be:

- `canvas`, `vips` and `heif` decode raster input and are bound by pixels for
  exactly the same reason. Their factors describe photographic content, where
  file size and pixel count correlate, and understate a flat PNG by two orders of
  magnitude.
- `pdf-split` holds one `PDFDocument` per page until the archive is written, so
  its cost scales with page count. `split-vector-large` is 200 pages of 0.3 MB
  peaking at 44 MB, which the model under-predicts by 10 MB.
- `pdf-render` accumulates every encoded page for the same reason.
- A `one-at-a-time` engine is budgeted on its largest *input*, and nothing budgets
  the *outputs* a long batch accumulates. Converting 300 images holds one bitmap
  at a time and 300 result blobs by the end. Browsers spill large blobs to disk,
  which is why this is a note rather than a factor, but it is a permission the
  multi-file budget grants and did not grant before.
