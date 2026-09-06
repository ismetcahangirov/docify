---
name: "a-pixel-bound-test-needs-a-device-without-simd"
description: "A test that means to exercise the decoded-pixel bound must route on a device with wasmSimd false, or vips answers and the assertion proves nothing"
type: "gotcha"
date: "2026-09-05"
---

wasm-vips is exempt from the raster pixel guard (see
[[raster-ceilings-are-two-and-scoped]]) and it serves jpg, png, webp, avif and
tiff. On the capable desktop `Capabilities` every test uses, that means the
pixel count decides *nothing* for an image conversion: a 900-megapixel PNG
routes to vips and is accepted at every one of those targets.

Set `wasmSimd: false` and vips is out of the running, canvas is the only raster
engine left, and canvas is bound by `width × height` rather than by file size.
That is the device class the bound exists for, and the only one a test can see
it on.

## What this cost

Issue #272 specified its own test — a 0.5 MB PNG declaring 30 000 × 30 000 gets
no image alternatives on `/convert/png-to-jpg`. Run as written, the job is not
even refused and the alternatives are identical with and without the pixel
count. The defect is real; the scenario in the issue is not. A sweep over
sources, targets, sizes and devices found the observable case:
`png -> jpg`, half a megabyte, a hundred megapixels, **no SIMD** — bytes alone
offer WebP, PDF and BMP; with the pixels, only PDF, and the other two are
exactly what the browser would refuse on the next drop.

`test/components/converter/alternatives.test.tsx` therefore carries its own
capability mock rather than sharing `converter.test.tsx`'s desktop one.

Related: [[budget-is-affine-and-scoped]], [[router-gates-before-budget]]
