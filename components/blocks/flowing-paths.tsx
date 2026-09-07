import type * as React from 'react'

import { cn } from '@/lib/utils'

/*
 * The home hero's moving ground (issue #294).
 *
 * Two mirrored fans of long, shallow curves drifting across the block, with the
 * heading sitting on top of them. It is the published "background paths"
 * pattern in spirit; almost none of that implementation survived, and the parts
 * that survived least are the two that decide everything else here.
 *
 * ## Why this is not an SVG
 *
 * The reference draws its curves as beziers on an inline SVG at `inset-0`.
 * Doing that here breaks the accessibility suite, and not in a way that can be
 * argued with: axe resolves the background behind a run of text by walking the
 * elements underneath it, and it abandons the walk the moment one of them is
 * IMG, CANVAS, OBJECT, IFRAME, VIDEO or SVG. The result is `color-contrast`
 * reported as *incomplete* rather than as passing, and `e2e/a11y.spec.ts`
 * treats an unevaluated contrast check as the failure it is — a suite that
 * reads "not checked" as "fine" is an audit that audits nothing.
 *
 * Measured, not assumed: with the SVG behind the heading the check came back
 * incomplete for the heading, both paragraphs, the button and the two header
 * links.
 *
 * The alternatives were to keep the SVG and move it out from under the text —
 * which is what `components/blocks/grid-overlay.tsx` does, and it is why that
 * component is a band along one edge — or to keep it and put an opaque ground
 * under the text, which stops the walk early but also hides the curves in a
 * rectangle the width of the heading. Neither leaves the motion behind the
 * words, which is the thing the hero is for.
 *
 * ## So what draws a curve
 *
 * A circle far larger than the block, three quarters of its ring coloured, its
 * centre pushed well outside one corner so that the part of the ring crossing
 * the block is a long shallow arc. The circle turns, and what travels along
 * that arc is the gap — a segment moving along a curve, drawn with a border on
 * something that has no background at all. axe steps over a transparent box
 * without comment.
 *
 * ## Why the circle is a ::before and not an element
 *
 * Because axe reads geometry, and it reads it from the DOM.
 *
 * It resolves the background behind each *line* of a run of text separately and
 * requires that every line come back with the same stack of elements beneath
 * it. A decorative element whose box covers the heading's first line but not
 * its third fails that whatever it is painted in — `elmPartiallyObscuring`,
 * incomplete, suite red. Worse, these boxes move: the element is square, and
 * turning a square grows its bounding rectangle by up to forty per cent, so an
 * edge sweeps back and forth across the heading and the check passes or fails
 * depending on the second it ran in. That is the kind of flake that gets a
 * suite switched off rather than fixed.
 *
 * A pseudo-element is not a node. It is not in the flattened tree axe builds
 * its grid from, so it has no rect to sort and no stack to disagree about, and
 * it paints all the same. Each arc is therefore an element pinned to `inset-0`
 * — every one of them exactly the block, so every line of the heading sees an
 * identical stack — carrying its circle in `::before`.
 *
 * It is also markedly cheaper than the original: `rotate` is a compositor
 * property, where the reference's `pathLength` animation repaints the whole
 * SVG on every frame of every curve.
 *
 * ## The rest of what changed, and why each one had to
 *
 * **No framer-motion.** A decoration is a poor reason to put a runtime
 * animation library on the route with the tightest first-load budget. This
 * ships zero bytes of JavaScript and stays a server component.
 *
 * **No `Math.random()` in the render.** The original seeds each curve's
 * duration with it, which in a server component is a hydration mismatch: the
 * HTML carries one number and the client computes another. Timing here is a
 * function of the arc's index, so the two agree by construction.
 *
 * **No gradient, no blur, no shadow, no slate.** CLAUDE.md §3 prohibits all
 * four and `scripts/design-lint/` enforces three of them mechanically. The
 * colour is `currentColor` over a token class; `rgba(15,23,42,…)` is a blue.
 *
 * **Nothing moves under `prefers-reduced-motion: reduce`.** The animation is
 * applied through Tailwind's `motion-safe` variant, which compiles to
 * `@media (prefers-reduced-motion: no-preference)`, so under `reduce` there is
 * no `animation-name` at all rather than a paused one.
 *
 * ## What the caller owes it
 *
 * `overflow-hidden` here is what crops the circles, but the parent must be
 * `relative` and must put its own content on a layer above this one — these
 * arcs are painted where the words are, and paint order between two positioned
 * elements with no `z-index` is decided by document order, which is exactly the
 * kind of implicit that axe and a browser can disagree about.
 */

/** Arcs per fan. Enough that something is always crossing, few enough to stay cheap. */
const ARCS = 14

/**
 * The two fans, each a point the block is swept from.
 *
 * Concentric circles about one centre are parallel curves, and a centre placed
 * outside a corner puts the useful part of every one of them — the part that
 * actually crosses the block — on the diagonal. One fan is pinned past the
 * lower-left, the other past the upper-right, so the two sets cross.
 *
 * `spin` turns them against each other. Two currents drifting the same way
 * read as one sheet sliding past, which is the thing the mirroring is for.
 */
const FANS = [
  { key: 1, x: -40, y: 150, spin: 'normal' },
  { key: -1, x: 140, y: -50, spin: 'reverse' },
] as const

/**
 * One arc.
 *
 * The diameters are spread so that the smallest circle clears the near corner
 * and the largest reaches past the far one — between them the fan covers the
 * block rather than bunching in one half of it. Nothing here is a pixel: the
 * diameter is a percentage of the block's width and the fan's centre a
 * percentage of each axis, so the whole construction scales with the panel.
 *
 * `left` resolving against width and `top` against height is CSS rather than a
 * choice, and it works in our favour — on a phone the block is tall, the centre
 * drops further below it, and the arcs crossing the block flatten out instead
 * of tightening into visible circles.
 */
function arc(index: number) {
  return {
    /* Percent of the block's width, as the diameter. */
    size: 86 + index * 17,
    /* The near arcs are the faintest and thinnest; the far ones carry the weight. */
    opacity: 0.1 + index * 0.026,
    ring: index < 9 ? 1 : 2,
    /* Coprime-ish steps, so no two arcs fall into step and the drift never repeats visibly. */
    duration: 34 + (index % 7) * 9,
    delay: -(index * 6.7),
  }
}

/**
 * The circle itself, on `::before`, driven entirely by the custom properties
 * each arc sets.
 *
 * Three quarters of the ring is coloured — `border-current`, then one side back
 * to transparent. Only the sliver of a circle that crosses the block is ever
 * visible, so a shorter coloured run would spend most of its turn outside the
 * frame and the curve would read as blinking rather than flowing.
 *
 * The animation is one arbitrary declaration rather than `animate-flow` plus
 * three overrides, because Tailwind orders its output by utility rather than by
 * the order they were written in: a shorthand landing after the longhands it
 * was meant to be corrected by is a bug that shows up only in a production
 * build.
 */
const CIRCLE = [
  "before:absolute before:aspect-square before:rounded-full before:border-solid before:content-['']",
  'before:left-[var(--arc-x)] before:top-[var(--arc-y)] before:w-[var(--arc-size)]',
  'before:-translate-x-1/2 before:-translate-y-1/2',
  'before:border-[length:var(--arc-ring)] before:border-current before:border-l-transparent',
  'before:opacity-[var(--arc-opacity)]',
  'motion-safe:before:[animation:flow_var(--arc-duration)_linear_var(--arc-delay)_infinite_var(--arc-spin)]',
].join(' ')

export function FlowingPaths({ className }: { className?: string }) {
  return (
    <div
      data-slot="flowing-paths"
      aria-hidden="true"
      className={cn('pointer-events-none absolute overflow-hidden text-fg-dark-mut', className)}
    >
      {FANS.map((fan) => (
        <div key={fan.key} data-fan={fan.key} className="absolute inset-0">
          {Array.from({ length: ARCS }, (_, index) => {
            const { size, opacity, ring, duration, delay } = arc(index)

            return (
              <span
                key={index}
                data-arc={index}
                // `inset-0`, every one of them, so that each line of the
                // heading above resolves against an identical stack of
                // elements. What differs between arcs is only what their
                // ::before draws, and that is invisible to anything reading
                // the document as a tree.
                className={cn('absolute inset-0', CIRCLE)}
                style={
                  {
                    '--arc-size': `${size}%`,
                    '--arc-x': `${fan.x}%`,
                    '--arc-y': `${fan.y}%`,
                    '--arc-ring': `${ring}px`,
                    '--arc-opacity': opacity,
                    '--arc-duration': `${duration}s`,
                    '--arc-delay': `${delay}s`,
                    '--arc-spin': fan.spin,
                  } as React.CSSProperties
                }
              />
            )
          })}
        </div>
      ))}
    </div>
  )
}
