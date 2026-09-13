---
name: "fonts-are-two-files-per-family"
description: "Each self-hosted family is a preloaded core file and an on-demand extended one — and the split has three traps that all fail silently"
type: "decision"
date: "2026-09-13"
---

Issue #315. Archivo, Inter and JetBrains Mono each ship as **two** woff2 files
since this: a *core* half scoped by `unicode-range` to what these pages actually
set, preloaded; and an *extended* half holding the rest of the vendored latin
subset, `preload: false`, which the browser fetches only for a character the
core range does not claim.

104.4kB of preloaded font became 47.4kB. On the CI runner that was LCP 2343 →
2129 on `/`, 2316 → 2039 on `/convert`, 2301 → 2033 on `/convert/heic-to-jpg`.
Why bytes are the whole of it: [[lcp-is-the-bytes-before-first-paint]].

The vendored Google originals moved to `assets/fonts/` so they are not served;
`pnpm subset:fonts` (`scripts/subset-fonts/`) cuts the six files in
`public/fonts/` and they are committed.

## The three traps, all of which were hit

**1. Do not derive one half from a written-down range.** The first version
subtracted the core range from Google's *published* `latin` `unicode-range`. The
vendored files map six codepoints that range does not name — Ă and five
Vietnamese combining marks — so they landed in neither half. macOS hands file
names over in NFD, so `Bảng-giá.pdf` would have drawn its letters from Inter and
its accents from Arial. `scripts/subset-fonts/coverage.mjs` now reads the cmap
out of the woff2 (a table directory, one Brotli stream, and Node decompresses
Brotli) and the extended half is the source's own coverage minus the core range.

**2. The metric-adjusted fallback is measured from a file, and it needs a–z.**
The core faces must carry no `fallback` and `adjustFontFallback: false`, because
Next appends the `local("Arial")` face to whichever face declares them and that
face has no `unicode-range` — between the two halves it would answer for every
accented character and the extended file would never load. So the tail hangs off
the extended face. But `getFallbackMetricsFromFontFile` derives `size-adjust`
from the average advance of the lowercase alphabet and gives up if any of it is
missing, and the extended half owns no ASCII: Inter's fallback silently went
from `size-adjust: 107.89%` to 100%, an 8% reflow when the real face lands that
no LCP gate can see. The extended files therefore carry a–z as ballast their
range never reaches.

**3. `keepFeatures` is an allowlist over harfbuzz's cleared defaults.** Passing
a "sensible" list of OpenType features silently drops every default-on feature
missing from it — `rvrn` most of all, Required Variation Alternates, applied
unconditionally to a variable font like Archivo. The list in `families.mjs` is
the default-on set written out in full. What it deliberately drops is the
*opt-in* features (`frac`, `numr`, `dnom`, `pnum`, `tnum`, stylistic sets), which
no stylesheet here asks for and whose lookups drag glyphs into the subset.

JetBrains Mono additionally drops `calt`, which is its entire ligature table —
the `->`, `!=`, `::` set. This site sets byte counts and file names in it, not
code. That one feature is 10.8kB of the saving.

## What guards it

`test/subset-fonts.test.ts` opens the shipped woff2 files. It has to: the first
version of that suite compared the two range lists to each other, one of which
was defined as the other's complement, and passed while the fonts were wrong.
It asserts the partition, the a–z ballast, and a 50kB ceiling on the preloaded
total. `e2e/fonts.spec.ts` counts font requests in a browser — three per route,
six once an extended character is rendered, and still three with every font
response delayed by three seconds, which is the swap window the counting test
cannot otherwise see.

Related: [[lighthouse-numbers-come-from-ci]], [[monochrome-design-constraint]]
