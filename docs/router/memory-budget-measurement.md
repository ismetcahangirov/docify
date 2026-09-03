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

The images → PDF scenarios also report the *decoded* pixels they put through
pdf-lib, and two extra columns derived from them. That is the axis the input
bytes cannot predict, and the one `lib/engines/raster-limits.ts` bounds — see
"the decoded-pixel ceiling" below. Only PNG is counted: `embedJpg` never runs a
decoder, so a JPEG's pixels cost nothing here.

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
| `canvas`, `heif` | **Measured in a browser**, by `browser-memory-measure.mjs` — see "the browser harness". Their `bytesPerPixel` and `heif`'s reserve come from it; their byte factors are the pixel-less fallback and remain unmeasured |
| `vips` | **Not measured.** It streams scanline regions and never materialises a bitmap, so it charges nothing per pixel and is exempt from the ceiling in the engines |
| `webcodecs` | **Not measured — derived.** The engine ships (#47), and its 2.5 did not survive contact with it: the pipeline holds the file rather than streaming it past. The 4 that replaced it (#210) is counted off what is live at the muxing peak, the same way `remux` is, and the count is written out in `lib/router/budget.ts`. Releasing the demuxed source as the decoder consumes it (`lib/engines/mp4-samples.ts`) is what keeps it at four terms rather than five |
| `ffmpeg`, `libarchive` | **Not measured.** Neither has a Node stand-in worth measuring, and `libarchive` has no engine at all yet. Their factors and `holds` values are carried over and are as good as the guess that produced them |

That harness is `browser-memory-measure.mjs`: Playwright driving a
cross-origin-isolated page through `performance.measureUserAgentSpecificMemory()`.
It is what closed the `canvas` and `heif` rows.

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

`images-flat-png-1`, `-3`, `-6` and `-24` are four more scenarios in the same
harness. They sweep the job size of the flat-PNG row rather than adding anything
to the table above, and they belong to "the decoded-pixel ceiling" below.

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

## The browser harness

`memory-measure.mjs` runs in Node and therefore cannot touch three of the nine
engines. `browser-memory-measure.mjs` next to it runs the same kind of sweep in
a real Chromium:

```bash
node docs/router/browser-memory-measure.mjs            # every scenario, ~9 minutes
node docs/router/browser-memory-measure.mjs canvas-    # by prefix
```

It builds its images with the generator `memory-corpus.mjs` exports, serves
them from a local origin, and reads
`performance.measureUserAgentSpecificMemory()` — the only API that reports what
a *renderer* holds rather than what the JS heap holds, which is the whole point
here: a decoded `ImageBitmap` is not on the JS heap at all.

Two launch conditions are not negotiable and cost an afternoon to find:

1. **Cross-origin isolation.** The API is gated on it, so the harness serves
   `Cross-Origin-Opener-Policy: same-origin` and
   `Cross-Origin-Embedder-Policy: require-corp` — the pair `next.config.ts`
   already sets on `/convert/*`.
2. **A process-isolated origin.** Chromium's *old* headless mode does not lock a
   renderer to a site and the call throws `SecurityError` there even though
   `crossOriginIsolated` is `true`. `channel: 'chromium'` selects the new
   headless, which works. Both were tried; the failure is reproducible.

The API is asynchronous and cannot chase a peak the way the Node sampler does,
so each scenario instead *holds* every allocation of its worst moment — source
blob, decoded bitmap, canvas, encoded output — and measures there. That is the
moment the engine occupies, and unlike a sampled peak it is reproducible.

One mistake is worth recording because it is invisible in the output: an early
version passed image bytes into the page through `page.evaluate`, which marshals
every byte into a JS array element. The incompressible image then reported
255 MB instead of 22.9 — the measurement was mostly of the argument. Images
arrive over HTTP for that reason.

### Browser results

Measured 2026-08-31, Chromium 142 (Playwright 1.62.1, new headless), Windows 11.

| scenario | in MB | Mpx | peak MB | peak/in | peak B/px |
| --- | ---: | ---: | ---: | ---: | ---: |
| `canvas-flat-1mpx` | 0.0 | 1.0 | 3.9 | 178.2 | 4.04 |
| `canvas-flat-2mpx` | 0.0 | 2.0 | 7.7 | 187.0 | 4.02 |
| `canvas-flat-6mpx` | 0.1 | 6.0 | 22.9 | 205.1 | 4.01 |
| `canvas-flat-12mpx` | 0.2 | 12.0 | 45.8 | 214.7 | 4.00 |
| `canvas-flat-24mpx` | 0.4 | 24.0 | 91.6 | 216.1 | 4.00 |
| `canvas-noise-6mpx` | 17.2 | 6.0 | 22.9 | **1.3** | 4.01 |
| `heif-module-only` | 0.0 | 0.0 | 20.5 | — | — |
| `heif-fixture-64` | 0.0 | 0.0 | 20.6 | 43 209 | — |

Each scenario ran twice, once writing PNG and once writing JPEG; the two agree
to three significant figures, which is what says the output format is not what
is being measured.

**The two rows that settle the argument are the last two canvas ones.** Six
megapixels of flat colour is 0.1 MB and six megapixels of noise is 17.2 MB —
165× apart in bytes, identical in pixels. Both peak at 22.9 MB. A model
expressed as a multiple of the encoded size has to be 205 for one of them and
1.3 for the other, and `MEMORY.canvas` was 6.

**`peak B/px` is flat at 4.00–4.04 across a 24× range in pixel count.** That is
the number `MEMORY.canvas.bytesPerPixel` is fitted to. It is charged as 6:
4.00 for the decoded bitmap and its canvas, plus 2 for the encoded output, which
`measureUserAgentSpecificMemory` does not attribute to the renderer at all — its
worst measured case is a 2.9 B/px incompressible PNG re-encode and its typical
case is 0.3.

**libheif costs 20.5 MB before it is shown a pixel.** `heif-module-only`
instantiates the module and decodes nothing. That is `MEMORY.heif.reserveBytes`,
rounded to 21 MB, and it is a cost no multiple of the input can express: the old
model priced the 499-byte fixture at 2.5 kB against a reality of 20.6 MB.

### What the browser sweep still cannot say

- **libheif's per-pixel cost.** The repository holds one HEIC, 64 × 64, and
  4096 pixels cannot separate a slope from noise. There is no HEIC encoder in
  this build — `libheif-js` ships the decoder only, which
  `lib/engines/heif-decode.ts` also relies on — so a corpus cannot be generated
  the way the PNG one is. `MEMORY.heif.bytesPerPixel` is 8 by arithmetic
  instead: `heif-decode.ts` allocates `width × height × 4` for the buffer
  libheif fills, `heif.ts` draws that onto a canvas, the canvas sweep measured
  that at 4.00, and both are live at once. This is the one row still waiting on
  a corpus.
- **A `Blob`'s backing store.** It is held by the browser process, not the
  renderer, and the API does not attribute it. This is why the byte factors stay
  as well as the pixel term, rather than being replaced by it.

### Why the byte factors stay

`MEMORY.canvas.factor` is still 6 and `MEMORY.heif.factor` is still 5, both
still unmeasured. They are what answers when the caller could not read a header:
`RouteFile.pixels` is optional, and a job with no bound at all is the failure
this table exists to prevent. Where both are known the job is charged both, and
over-charging a job whose pixels are known is the safe direction.

## The decoded-pixel ceiling

`images-flat-png-12` is the row that broke the model, and it is now the row the
engines guard themselves against. Twelve screenshots totalling **750 kB** peak
between **150 MB and 193 MB** across the runs below — up to 263× their input — because
pdf-lib decodes a PNG to raw samples, holds them uncompressed until `save()`
deflates them, and a decoded bitmap is `width × height × bytes-per-pixel` however
well the file compressed. The identical pixel count as grain (`images-png-12`) is
103 MB of input for 184 MB of peak, or 1.8×.

No input-size-relative factor describes both rows, and no fixed reserve does
either, because the cost scales with the number of images. `route()` is handed
byte counts and never opens a file (CLAUDE.md §5.1), so **this bound cannot be
enforced in `lib/router/`.** It belongs to the engine, beside the bytes it is
decoding — the same shape as `canvasSize()` in `pdf-render-plan.ts`, which
refuses a page before it allocates it. That is `lib/engines/raster-limits.ts`,
and this is where its number came from.

### The sweep

The same flat PNG at five job sizes, so the cost can be read off a slope rather
than off one point. Two consecutive runs, same machine and same Node flags as the
table above. `peak+blob` is the browser-side peak; `/px` divides it by the
decoded pixels rather than by the input bytes.

| Scenario | Images | Input MB | Mpx | peak+blob MB (run 1 / run 2) | bytes/px (run 1 / run 2) |
| --- | ---: | ---: | ---: | ---: | ---: |
| `images-flat-png-1` | 1 | 0.06 | 3.0 | 32.1 / 32.1 | 11.21 / 11.21 |
| `images-flat-png-3` | 3 | 0.18 | 9.0 | 75.6 / 72.3 | 8.81 / 8.42 |
| `images-flat-png-6` | 6 | 0.37 | 18.0 | 118.2 / 121.1 | 6.88 / 7.06 |
| `images-flat-png-12` | 12 | 0.73 | 36.0 | 192.7 / 149.6 | 5.61 / 4.36 |
| `images-flat-png-24` | 24 | 1.47 | 72.0 | 269.0 / 242.9 | 3.92 / 3.54 |
| `images-png-12` (grain) | 12 | 103.0 | 36.0 | 287.1 / 287.1 | 8.36 / 8.36 |

Two things to read out of it, both of which decided the constant.

**The per-pixel cost is not constant, and the worst of it is at the bottom.**
pdf-lib costs ~32 MB before a single pixel is considered — the same allocation
the 32 MB `reserveBytes` already describes — so one image looks like 11 bytes per
pixel and twenty-four look like 4. A ceiling has to be right where it *binds*,
which is where the curve crosses the smallest platform budget, not at either end.

**The crossing is at 12 megapixels.** Taking the worse run: 9 Mpx peaks at
75.6 MB and 18 Mpx at 118.2 MB, a marginal 4.96 bytes per pixel, so 90 MB — the
iOS budget, and the smallest any platform gets — is reached at 12.05 Mpx. That
is `90 MB ÷ 12.05 Mpx = 7.83` bytes per pixel, and
`PDFLIB_DECODED_BYTES_PER_PIXEL` is **8**: the next whole number up, which puts
the ceiling at 11.8 Mpx, just inside the crossing.

Checked at the other two budgets rather than assumed to scale:

| Budget | Ceiling at 8 B/px | Measured peak there | Verdict |
| --- | ---: | ---: | --- |
| iOS, 90 MB | 11.8 Mpx | ~90 MB (interpolated) | binds exactly |
| Android / desktop floor, 140 MB | 18.4 Mpx | 118 MB at 18 Mpx | 22 MB of headroom |
| Desktop cap, 1200 MB | 157 Mpx | ~470 MB extrapolated | conservative by 2.5× |

Conservative at the top end is the safe direction: the desktop budget is the one
platform where an over-tight ceiling costs a user something, and 157 Mpx is a
larger images → PDF job than the app has any other reason to accept.

The twelve screenshots that opened the issue are 36 Mpx, so a phone and a
140 MB device refuse them and a desktop accepts them — which is the answer both
measurements support.

JPEG is charged nothing at all, which is what keeps the common case out of the
way of this: `embedJpg` scans to SOF0 and copies the bytes into a `DCTDecode`
stream without running a Huffman decoder, so `images-jpg-24` carries 288 Mpx and
still peaks at 1.7× its bytes. A phone making a PDF of its own camera roll is
unaffected by the ceiling entirely.

### Which budget the engine uses

`budgetBytes(caps)` is pure and is the right number, but it has to be handed
over: the conversion worker carries no `Capabilities`, deliberately, because it
never re-routes (CLAUDE.md §2.4, `lib/worker/types.ts`). `EngineInput.budgetBytes`
is the field the main thread puts its already-computed answer in — a number, not
the `Capabilities` it came from, so the worker still cannot decide anything.

`conversionRequest()` in `lib/worker/request.ts` is what fills it, and it is the
only thing that assembles a `ConvertRequest`. It takes the accepted
`RouteSuccess` and the `Capabilities` that decision was made against in one
call, which is what makes the two impossible to mismatch: there is no way to
send an engine chosen for one device with a budget computed for another. Before
#177 nothing set the field at all, and every job on every device silently ran at
the desktop floor.

When it is absent, `DEFAULT_BUDGET_BYTES` applies, and that is
`DESKTOP_BUDGET_FLOOR_BYTES` (140 MB) rather than the iOS ceiling. That is a
deliberate departure from "assume the weakest device", and the reason is that
this is a *second* bound on an axis the router cannot see, not a replacement for
the router's own check — that one already ran, against the real device budget, on
the job's bytes. Assuming a phone here would refuse, on a workstation, a job
measured at 118 MB against a 1200 MB allowance. The floor still refuses the
runaway case this exists for, on every device.

### The other three raster engines, and why only one of them shares this number

One helper serves all of them rather than a copy each: they need the same header
readers, the same arithmetic and — the reason that settles it — the same
sentence, because a refusal whose wording changes with the engine teaches the
user nothing (CLAUDE.md §2.5). But they do **not** share this ceiling, because
only pdf-lib's per-pixel cost has been measured.

`canvas` and `heif` are bounded by `assertBitmapFits` instead: at most
16 384 px on a side and 67.1 Mpx in total, which is what a browser canvas can
hold before it silently returns a blank surface. That is a *fact* rather than an
estimate, it is the same pair of numbers `canvasSize()` in `pdf-render-plan.ts`
already uses, and it refuses a file no browser could have rendered anyway.

It is tempting to give them a budget-derived ceiling too, and it would be wrong
today. What a decoded `ImageBitmap` plus the canvas it is drawn onto actually
costs has never been measured — `createImageBitmap` and `OffscreenCanvas` have no
Node stand-in, which is exactly why `MEMORY.canvas` and `MEMORY.heif` are
unmeasured in the table above. The obvious structural estimate is 8 bytes per
pixel, four of RGBA and four for the canvas, and at the iOS budget that puts the
ceiling at 11.8 Mpx — below a 4032 × 3024 iPhone photo, which is the single
commonest input the app has and the entire reason the HEIC engine exists.
Refusing the app's headline conversion on the strength of an unmeasured constant
is a worse outcome than the crash it was guarding against. Measuring it needs the
Playwright harness this document already says has not been built; until then the
factual ceiling is the honest one.

`vips` is bounded by neither, and that is also deliberate. libvips never
materialises the bitmap: `newFromBuffer` with `access: 'sequential'` hands the
writer scanline regions and `thumbnailBuffer` shrinks on load inside the codec.
That is why `MEMORY.vips` is 4 where `MEMORY.canvas` is 6, and a pixel ceiling
there would refuse work the engine finishes in a few hundred kilobytes. If an
operation ever forces a random-access pipeline, the ceiling comes back with it.

### Where each check sits

Every one of them is before the allocation it guards, which is the only placement
worth having — an out-of-memory inside a browser decoder is a blank tab, not a
catchable error.

| Engine | Reads the size from | Refuses before |
| --- | --- | --- |
| `pdf-from-images` | the PNG `IHDR` | `embedPng` |
| `canvas` | the PNG `IHDR`, JPEG `SOF0` or WebP `VP8X`/`VP8 ` | `createImageBitmap` |
| `canvas` (again) | the decoded `ImageBitmap` | `new OffscreenCanvas` |
| `heif` | libheif's own `get_width`/`get_height` | `new Uint8ClampedArray(w * h * 4)` |

The second canvas row is not redundancy. A browser also decodes BMP, AVIF and,
on Apple hardware, HEIC, and `lib/engines/raster-size.ts` has no reader for any
of them; abstaining and checking the decoded bitmap one allocation later is
better than guessing at a header format.

## What the model still cannot see

`images-flat-png-12` used to be the row this section opened with. It is now
`lib/engines/raster-limits.ts`'s job, guarded before `embedPng` and measured
above. These are the holes that are still open:

- **libheif per pixel**, and only that: see "what the browser sweep still
  cannot say". Everything else about `canvas` and `heif` is now measured.
- `pdf-split` holds one `PDFDocument` per page until the archive is written, so
  its cost scales with page count. `split-vector-large` is 200 pages of 0.3 MB
  peaking at 44 MB, which the model under-predicts by 10 MB.
- `pdf-render` accumulates every encoded page for the same reason.
- A `one-at-a-time` engine is budgeted on its largest *input*, and nothing budgets
  the *outputs* a long batch accumulates. Converting 300 images holds one bitmap
  at a time and 300 result blobs by the end. Browsers spill large blobs to disk,
  which is why this is a note rather than a factor, but it is a permission the
  multi-file budget grants and did not grant before.
