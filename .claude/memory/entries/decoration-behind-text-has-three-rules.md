---
name: "decoration-behind-text-has-three-rules"
description: "A decorative layer under text must not be an SVG, must give every arc the same box, and must declare its own z-index — axe cannot rate contrast otherwise"
type: "decision"
date: "2026-09-07"
---

Discovered building the home hero's flowing curves (#294), by measurement
rather than from the docs. `e2e/a11y.spec.ts` asserts that `color-contrast`
was *evaluated*, not merely that it did not fail, and axe reports a check it
could not run as `incomplete`. Three separate things make it unable to run, and
a decorative layer behind text can hit all three.

**1. It may not be an SVG.** axe resolves the background behind a text run by
walking the elements under it and abandons the walk on IMG, CANVAS, OBJECT,
IFRAME, VIDEO or SVG (`elementHasImage`, reason `imgNode`). An inline SVG at
`inset-0` behind the hero made the check incomplete for the heading, both
paragraphs, the button and both header links. This is why
`components/blocks/grid-overlay.tsx` is a band along one edge and says so — the
note there was right, and it is a constraint on the composition, not a detail.
A transparent element with a border is walked straight over, so curves drawn as
`border-radius` on empty boxes are fine where an SVG is not.

**2. Every element under the text needs the same box.** axe resolves each
*line* of a run separately and fails with `elmPartiallyObscuring` if the stacks
differ. A decoration element covering the heading's first line but not its
third breaks it whatever it is painted in. Worse when the boxes move: a square
element's bounding rect grows up to 40% as it rotates, so an edge sweeps across
the heading and the check passes or fails depending on the second it ran in —
it passed run alone and failed under `--workers=2`, which is the profile of a
flake that gets a suite switched off. The fix was to give every arc `inset-0`
and move the drawing to `::before`. A pseudo-element is not in the flattened
tree axe builds its grid from, so it has no rect and joins no stack.

**3. Paint order has to be explicit.** Two positioned elements with no
`z-index` are painted in document order, and axe's `_visuallySort` does not
always agree with the browser: it put the arcs *above* the heading and reported
`bgOverlap`. `z-10` on the hero content over `z-0` on the decoration fixed it.
`overflow: hidden` is no help at all here — axe reads layout rects, and a
clipped element's rect is still its full box, which is why the arcs reached up
over the site header and `SiteHeader` now carries a `z-10` of its own.

None of this shows up as a violation. It shows up as a check that silently did
not happen, which is exactly what that suite exists to catch.

Related: [[monochrome-design-constraint]]
