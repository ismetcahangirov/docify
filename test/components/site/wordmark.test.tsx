import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Wordmark } from '@/components/site/wordmark'
import { SITE_NAME } from '@/lib/seo/site'

/*
 * The wordmark and the brush behind its initial (issue #311).
 *
 * What is asserted here is not how the mark looks. It is the three properties
 * that decide whether the page still passes `e2e/a11y.spec.ts`, which treats an
 * axe check that could not run as the failure it is: the decoration may not be
 * an SVG, every element behind the letter has to carry the same box, and the
 * paint order has to be stated rather than inferred from document order. The
 * hero's flowing curves were built against the same three rules.
 */
describe('Wordmark', () => {
  it('reads as the site name, in one run, whatever it is split into', () => {
    const { container } = render(<Wordmark />)

    expect(container.textContent).toBe(SITE_NAME)
  })

  it('keeps the initial and the rest of the name in the same text flow', () => {
    const { container } = render(<Wordmark />)
    const mark = container.querySelector('[data-slot="wordmark"]')

    expect(mark?.textContent).toBe(SITE_NAME)
    expect(container.querySelector('[data-slot="wordmark-initial"]')?.textContent).toBe(
      SITE_NAME[0],
    )
  })

  it('draws the brush without an image node, and without a raw colour', () => {
    const { container } = render(<Wordmark />)

    // The drawing is a mask over a flat fill. An <img>, an inline <svg> or a
    // background-image would carry the same picture and stop axe resolving
    // what is behind the letter.
    expect(container.querySelector('svg')).toBeNull()
    expect(container.querySelector('img')).toBeNull()
    expect(container.innerHTML).not.toMatch(/background-image/)
    expect(container.innerHTML).not.toMatch(/#[0-9a-f]{3,8}\b/i)
    expect(container.innerHTML).not.toMatch(/gradient/i)
  })

  it('cuts the paint to a mask that is actually in the repository', () => {
    const { container } = render(<Wordmark />)
    const paint = container.querySelector('[data-layer="paint"]')
    const url = paint?.getAttribute('style')?.match(/url\(([^)]+)\)/)?.[1]

    expect(paint?.className).toMatch(/mask-image/)
    // Safari still needs the prefixed property, and a mask that only half
    // applies is a plain pink rectangle behind the letter.
    expect(paint?.className).toMatch(/-webkit-mask-image/)
    expect(url).toBeDefined()

    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
    const file = join(repoRoot, 'public', url as string)

    expect(existsSync(file), `${url} is referenced but is not in public/`).toBe(true)
    expect(readFileSync(file, 'utf8')).toMatch(/<svg/)
  })

  it('hides the brush from assistive technology and from pointer events', () => {
    const { container } = render(<Wordmark />)
    const layers = [...container.querySelectorAll('[data-slot="wordmark-brush"]')]

    expect(layers.length).toBeGreaterThan(0)
    for (const layer of layers) {
      expect(layer).toHaveAttribute('aria-hidden', 'true')
      expect(layer).toHaveClass('pointer-events-none')
    }
  })

  it('gives every layer behind the letter the same box, so axe reads one stack', () => {
    const { container } = render(<Wordmark />)
    const layers = [...container.querySelectorAll('[data-slot="wordmark-brush"]')]

    for (const layer of layers) {
      expect(layer).toHaveClass('absolute', 'inset-0', 'z-0')
    }
  })

  it('states the paint order rather than leaving it to document order', () => {
    const { container } = render(<Wordmark />)
    const initial = container.querySelector('[data-slot="wordmark-initial"]')

    expect(initial).toHaveClass('relative', 'z-10')
  })

  it('grows from md up and stays on the type scale', () => {
    const { container } = render(<Wordmark />)
    const mark = container.querySelector('[data-slot="wordmark"]')

    expect(mark).toHaveClass('text-h3', 'md:text-wordmark')
  })

  it('takes extra classes from the caller', () => {
    const { container } = render(<Wordmark className="font-display uppercase" />)
    const mark = container.querySelector('[data-slot="wordmark"]')

    expect(mark).toHaveClass('font-display', 'uppercase')
  })
})
