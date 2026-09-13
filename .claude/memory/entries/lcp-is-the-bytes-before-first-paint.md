---
name: "lcp-is-the-bytes-before-first-paint"
description: "Lighthouse's LCP here is not a paint time — it is the simulated arrival of the last byte fetched before first paint, so the only lever is the size of that set"
type: "gotcha"
date: "2026-09-13"
---

Issue #315. The home page measured LCP 2444ms against a 2500ms gate while its
own trace said the largest element painted at **152ms**. Both numbers are right,
and understanding why is the whole of the fix.

## What the number is

Lighthouse does not report the LCP it observed. It reports Lantern's
**simulation** of it, and `LargestContentfulPaint.getEstimateFromSimulation` is
literally:

```js
Math.max(...simulationResult.nodeTimings.values().map(t => t.endTime))
```

over a graph that `getFirstPaintBasedGraph` prunes to *every network node that
finished before the observed LCP*, plus the CPU nodes that performed layout.
Nothing about paint. Nothing about the LCP element. It is "when would the last
of these resources have arrived on a 1.6 Mbps link with a 150ms round trip".

So on a page whose largest element is a heading in the HTML, LCP is a **byte
count**. Measured across the three audited URLs on the CI runner: ~235kB in the
graph gave 2300–2450ms, and taking 57kB out of it gave 2030–2130ms. The slope is
about 4–5ms per kilobyte and it is the only lever there is. TBT and CPU move it
by tens of milliseconds; bytes move it by hundreds.

## What this rules out, cheaply

Anything that is not bytes-before-first-paint is not worth measuring twice:

- **`components/blocks/flowing-paths.tsx`** — 28 animated arcs behind the hero
  heading. Removing it entirely was worth 68ms locally, most of that its 2.5kB
  of markup. The decoration is not the problem, and it stayed. See
  [[decoration-behind-text-has-three-rules]].
- **The JavaScript.** 103kB of it, and all of it is React plus the App Router
  client runtime. Every route ships the same two chunks whether or not it has a
  client component, and `/` has one (the analytics beacon). There is no barrel
  import to find here — see [[barrel-imports-cost-a-budget]] for the one there
  was.
- **Preloading.** Adding `<link rel=preload>` for the fonts moved FCP 1664ms →
  760ms and CLS to zero, and moved LCP by 5ms. It changes when a node starts,
  not how many bytes are in the set.

What was left was the fonts: 105kB of the 235kB, and 148 of their 230 codepoints
were never drawn by any page. See [[fonts-are-two-files-per-family]].

## It is not a smooth slope: the document has a cliff at ~14.6kB

Found on the rebased #312, which added ~2kB to every page and paid 150ms on two
of them and nothing on the third:

| page | document + stylesheet | FCP |
| --- | --- | --- |
| `/` | 22.0kB → 25.3kB | 773ms → 919ms |
| `/convert` | 22.2kB → 24.4kB | 770ms → 919ms |
| `/convert/heic-to-jpg` | 16.2kB → 18.2kB | 768ms → **768ms** |

The two that paid are the two whose *document* crossed 14.6kB — 13,840 → 15,747
and 14,013 → 14,826. The one that did not is 8.6kB and still comfortably inside.
That number is Lantern's initial congestion window, ten packets of 1460 bytes,
and crossing it costs a whole 150ms round trip however few bytes do the
crossing.

So the 4–5ms per kilobyte above is an average over the whole set. The
render-blocking chain — the document, then the stylesheet — is charged in round
trips instead, and a page sitting just under the line is one paragraph of copy
away from an extra one.

## The corollary for the gate

`largest-contentful-paint` on `/` is, in practice, a budget on how much the
first screen downloads. A change that adds a 30kB resource discovered before
first paint costs ~150ms of it whether or not anybody can see the resource.

Related: [[lighthouse-numbers-come-from-ci]], [[converter-is-a-deferred-island]]
