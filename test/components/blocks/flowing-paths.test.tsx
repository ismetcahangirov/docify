import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { FlowingPaths } from '@/components/blocks/flowing-paths'

/*
 * The hero's moving ground (issue #294).
 *
 * The published pattern this is modelled on reaches for framer-motion,
 * `Math.random()`, a text gradient, a backdrop blur and a slate stroke, and
 * draws its curves as an inline SVG. Every one of those is either prohibited
 * here or breaks something, and the SVG breaks the most interesting thing — see
 * the note in the component. So this is a reimplementation, and what is
 * asserted below is the set of properties that made it one.
 *
 * How it looks is not among them. That is the screenshot's job, and a test
 * pinning the arc geometry would fail the first time somebody retuned the
 * composition, which is exactly the change this file should stay out of the way
 * of.
 */

/** Every arc element, in document order. */
const arcs = (container: HTMLElement) =>
  [...container.querySelectorAll('[data-arc]')] as HTMLElement[]

describe('FlowingPaths', () => {
  it('is decoration, hidden from assistive technology and from the pointer', () => {
    const { container } = render(<FlowingPaths />)
    const root = container.querySelector('[data-slot="flowing-paths"]')

    expect(root).toHaveAttribute('aria-hidden', 'true')
    expect(root).toHaveClass('pointer-events-none')
  })

  it('draws nothing with an element axe treats as a picture', () => {
    // This is the first reason the component is not an SVG. axe resolves the
    // background behind a run of text by walking the elements under it, and it
    // gives up the moment one of them is IMG, CANVAS, OBJECT, IFRAME, VIDEO or
    // SVG — reporting `color-contrast` as *incomplete*, which
    // `e2e/a11y.spec.ts` treats as the failure it is.
    const { container } = render(<FlowingPaths />)

    expect(container.querySelector('svg, img, canvas, object, iframe, video')).toBeNull()
  })

  it('gives every arc the same box, so every line of the heading sees one stack', () => {
    // This is the second reason, and the one that decided the shape of the
    // component. axe resolves each *line* of a text run separately and requires
    // that all of them come back with the same stack of elements beneath. An
    // arc whose box covered the heading's first line but not its third would
    // fail that whatever it was painted in. So the boxes are identical and the
    // circles live on `::before`, which is not a node and has no rect at all.
    const { container } = render(<FlowingPaths />)

    for (const element of arcs(container)) {
      expect(element).toHaveClass('absolute', 'inset-0')
      expect(element.className).toMatch(/\bbefore:absolute\b/)
    }
  })

  it('keeps every arc transparent, so the walk is never stopped by a fill either', () => {
    // An opaque element that does not fully cover the text stops the walk just
    // as an image does. The colour is on the pseudo-element's border; the boxes
    // themselves have no background at all.
    const { container } = render(<FlowingPaths />)

    for (const element of arcs(container)) {
      expect(element.style.backgroundColor).toBe('')
      expect(element.className).not.toMatch(/(?<!:)\bbg-/)
    }
  })

  it('takes its colour from a token, through currentColor', () => {
    const { container } = render(<FlowingPaths />)

    // Not `rgba(15,23,42,…)`, which is the reference implementation's stroke
    // and is a blue. CLAUDE.md §3 allows no hue outside the @theme palette,
    // and `scripts/design-lint/` would reject the literal anyway.
    expect(container.querySelector('[data-slot="flowing-paths"]')).toHaveClass('text-fg-dark-mut')
    for (const element of arcs(container)) {
      expect(element.className).toMatch(/\bbefore:border-current\b/)
    }
  })

  it('draws with no gradient and no colour literal anywhere', () => {
    const { container } = render(<FlowingPaths />)

    expect(container.innerHTML).not.toMatch(/gradient|#[0-9a-f]{3,8}\b|rgba?\(/i)
  })

  it('renders the same markup twice, so the server and the client agree', () => {
    // The reference implementation seeds each curve's duration with
    // `Math.random()` inside the render. In an app router server component that
    // is a hydration mismatch: the HTML says one number and the client another.
    // Timing here is a function of the arc's index and nothing else.
    const first = render(<FlowingPaths />).container.innerHTML
    const second = render(<FlowingPaths />).container.innerHTML

    expect(first).toBe(second)
  })

  it('mirrors one fan of arcs into two that cross', () => {
    const { container } = render(<FlowingPaths />)
    const fans = container.querySelectorAll('[data-fan]')

    expect([...fans].map((fan) => fan.getAttribute('data-fan'))).toEqual(['1', '-1'])
    for (const fan of fans) expect(fan.querySelectorAll('[data-arc]').length).toBeGreaterThan(4)
  })

  it('turns the two fans against each other', () => {
    // Both fans run the same keyframe; the second runs it backwards. Two sets
    // of curves drifting the same way read as one sheet sliding past, which is
    // the thing the mirroring exists to avoid.
    const { container } = render(<FlowingPaths />)
    const spin = (fan: string) =>
      new Set(
        [...container.querySelectorAll<HTMLElement>(`[data-fan="${fan}"] [data-arc]`)].map(
          (element) => element.style.getPropertyValue('--arc-spin'),
        ),
      )

    expect(spin('1')).toEqual(new Set(['normal']))
    expect(spin('-1')).toEqual(new Set(['reverse']))
  })

  it('only ever animates when motion has not been declined', () => {
    // `e2e/a11y.spec.ts` loads every page under `prefers-reduced-motion: reduce`
    // and fails it if a single element has a running animation. The animation is
    // behind Tailwind's `motion-safe` variant, which compiles to
    // `@media (prefers-reduced-motion: no-preference)` — so under `reduce` there
    // is no animation-name at all, not merely a paused one.
    const { container } = render(<FlowingPaths />)

    for (const element of arcs(container)) {
      expect(element.className).toMatch(/\bmotion-safe:before:\[animation:flow_/)
      expect(element.className).not.toMatch(/(?<!motion-safe:)\bbefore:\[animation:/)
    }
  })

  it('gives each arc its own timing, so the fan drifts rather than pulses', () => {
    const { container } = render(<FlowingPaths />)
    const values = (name: string) =>
      new Set(arcs(container).map((element) => element.style.getPropertyValue(name)))

    expect(values('--arc-delay').size).toBeGreaterThan(1)
    expect(values('--arc-duration').size).toBeGreaterThan(1)
    for (const delay of values('--arc-delay')) expect(delay).not.toBe('')
  })

  it('sizes and places every arc in percentages, so the fan survives any aspect', () => {
    // The hero is a wide, short panel on a desktop and a narrow, tall one at
    // 320px. Nothing here is a pixel except the ring's own thickness: the
    // diameter and both offsets are percentages, so the fan is one construction
    // scaled rather than one that shears with the panel.
    const { container } = render(<FlowingPaths />)

    for (const element of arcs(container)) {
      expect(element.style.getPropertyValue('--arc-size')).toMatch(/^\d+%$/)
      expect(element.style.getPropertyValue('--arc-x')).toMatch(/^-?\d+%$/)
      expect(element.style.getPropertyValue('--arc-y')).toMatch(/^-?\d+%$/)
    }
  })

  it('lets the caller place it, and clips its own overflow', () => {
    const { container } = render(<FlowingPaths className="inset-0 size-full" />)

    expect(container.querySelector('[data-slot="flowing-paths"]')).toHaveClass(
      'absolute',
      'inset-0',
      'size-full',
      'overflow-hidden',
    )
  })
})
