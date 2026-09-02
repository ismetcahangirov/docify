/*
 * Shared vocabulary for the responsive audit (issue #20).
 *
 * The two `collect*` functions in this file are the only ones that run inside
 * the browser. Playwright serialises them with `Function.prototype.toString()`,
 * so neither may reference anything in module scope — every constant they need
 * arrives as an argument, and every helper they use is declared in their own
 * body. That is why the file reads more repetitively than it otherwise would.
 */

/** A rung of the ladder the audit sweeps. */
export type Breakpoint = {
  /** Viewport width in CSS pixels. */
  width: number
  /** Viewport height, chosen to match a real device at that width. */
  height: number
  /** What this width stands for, used in failure messages. */
  label: string
}

/**
 * The ladder, 320px to 2560px — the range CLAUDE.md section 3 declares as the
 * responsive contract.
 *
 * The rungs are not evenly spaced because breakage is not evenly distributed.
 * The bottom three are clustered because that is where a fixed-width child or
 * an unbreakable word first pushes the document wider than the viewport, and
 * because 320px is the narrowest viewport still in circulation. The middle
 * three sit on Tailwind's `md`, `lg` and `xl` boundaries, where a grid changes
 * its column count and a layout is most likely to be wrong on one side of the
 * change. The top three cover `2xl` and beyond, where the risk inverts: a
 * container that never stops growing, or one pinned to a `min-width` larger
 * than it needs.
 */
export const BREAKPOINTS: readonly Breakpoint[] = [
  { width: 320, height: 568, label: 'smallest phone in circulation' },
  { width: 360, height: 740, label: 'common Android phone' },
  { width: 390, height: 844, label: 'modern iPhone' },
  { width: 768, height: 1024, label: 'tablet portrait — Tailwind md' },
  { width: 1024, height: 768, label: 'tablet landscape — Tailwind lg' },
  { width: 1280, height: 800, label: 'small laptop — Tailwind xl' },
  { width: 1536, height: 864, label: 'laptop — Tailwind 2xl' },
  { width: 1920, height: 1080, label: 'desktop' },
  { width: 2560, height: 1440, label: 'wide desktop' },
]

/**
 * The minimum hit area of an interactive element, in CSS pixels.
 *
 * 44 comes from WCAG 2.2 success criterion 2.5.5 (Target Size, Enhanced) and is
 * restated in the responsive contract of the docify-design skill. It is also
 * the height of the primary button (`h-11`), so the design system already meets
 * it by construction — this constant exists to keep it that way.
 */
export const MIN_TOUCH_TARGET_PX = 44

/** What the browser reports back about horizontal overflow on one page. */
export type OverflowReport = {
  /** `document.documentElement.scrollWidth`. */
  scrollWidth: number
  /** `document.documentElement.clientWidth` — the viewport minus any scrollbar. */
  clientWidth: number
  /** Human-readable descriptions of the elements that reach past the viewport. */
  offenders: string[]
}

/**
 * Runs in the browser. Measures the document against its own viewport and names
 * the elements sticking out of it.
 *
 * `scrollWidth` versus `clientWidth` is the acceptance criterion, but on its own
 * it is a number with no address attached — a failure would say the page is 40px
 * too wide and leave the next person bisecting the DOM by hand. The offender
 * list is what makes the gate cheap enough to keep.
 *
 * The list also catches something `scrollWidth` cannot. `overflow-x: hidden` on
 * `<body>` is the usual reflex fix for a responsive bug: it removes the
 * scrollbar, so the criterion passes, while the content stays cut off at the
 * right edge. Only a scroll container *below* `<body>` is treated as a
 * legitimate reason for a wide child here, which is exactly the escape hatch the
 * design system grants tables and code blocks ("their own `overflow-x-auto`
 * container") and nothing more.
 */
export function collectHorizontalOverflow(): OverflowReport {
  const root = document.documentElement
  const limit = root.clientWidth

  const describe = (element: Element): string => {
    const tag = element.tagName.toLowerCase()
    const id = element.id ? `#${element.id}` : ''
    const className = element.getAttribute('class') ?? ''
    const classes = className
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((name) => `.${name}`)
      .join('')
    const text = (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40)
    const right = Math.round(element.getBoundingClientRect().right)
    return `${tag}${id}${classes}${text ? ` "${text}"` : ''} → right edge at ${right}px`
  }

  const scrollsHorizontally = (element: Element): boolean => {
    const { overflowX } = getComputedStyle(element)
    return (
      overflowX === 'auto' ||
      overflowX === 'scroll' ||
      overflowX === 'hidden' ||
      overflowX === 'clip'
    )
  }

  const overflowing: Element[] = []

  for (const element of Array.from(document.body.querySelectorAll('*'))) {
    const rect = element.getBoundingClientRect()

    // Nothing rendered, nothing to overflow.
    if (rect.width === 0 && rect.height === 0) continue

    // A one-pixel allowance for sub-pixel layout rounding. Anything that
    // actually causes a scrollbar is wider than that by a wide margin.
    if (rect.right <= limit + 1) continue

    // Deliberately not checking `rect.left`: content off the left edge does not
    // scroll an LTR document, and flagging it would fail every visually-hidden
    // skip link, which is a pattern the accessibility rules require.

    let insideScrollContainer = false
    for (
      let ancestor = element.parentElement;
      ancestor && ancestor !== document.body;
      ancestor = ancestor.parentElement
    ) {
      if (scrollsHorizontally(ancestor)) {
        insideScrollContainer = true
        break
      }
    }
    if (insideScrollContainer) continue

    overflowing.push(element)
  }

  // An overflowing child drags every ancestor's box out with it, so reporting
  // all of them buries the one line that matters under its own parent chain.
  const innermost = overflowing.filter(
    (element) => !overflowing.some((other) => other !== element && element.contains(other)),
  )

  return {
    scrollWidth: root.scrollWidth,
    clientWidth: limit,
    offenders: innermost.map(describe),
  }
}

/** One interactive element that renders smaller than the minimum hit area. */
export type SmallTouchTarget = {
  /** Tag, id, first classes and leading text — enough to find it in the source. */
  descriptor: string
  /** Rendered width in CSS pixels, rounded to one decimal. */
  width: number
  /** Rendered height in CSS pixels, rounded to one decimal. */
  height: number
}

/**
 * Runs in the browser. Returns every interactive element whose rendered box is
 * smaller than `minSize` in either axis.
 *
 * Two kinds of element are left out, and neither is a softening of the rule:
 *
 * - Anything that is not rendered, hidden from assistive technology, or made
 *   non-interactive with `inert`. None of these can be tapped, so a size for
 *   them is meaningless.
 * - A link sitting inline in a run of prose. WCAG 2.2 carves this out
 *   explicitly (2.5.8, the "inline" exception) because such a link is sized by
 *   the line box of the sentence containing it; padding it to 44px would
 *   overlap the lines above and below. The test is narrow on purpose — the
 *   element must be an `<a>`, its computed display must be inline, and its
 *   parent must hold real text alongside it. A link on its own line, in a nav,
 *   or in a list is none of those things and is still held to the full 44px.
 */
export function collectSmallTouchTargets(minSize: number): SmallTouchTarget[] {
  const INTERACTIVE = [
    'a[href]',
    'button',
    'input',
    'select',
    'textarea',
    'summary',
    '[role="button"]',
    '[role="link"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="switch"]',
    '[role="tab"]',
    '[role="menuitem"]',
    '[tabindex]:not([tabindex="-1"])',
  ].join(',')

  const describe = (element: Element): string => {
    const tag = element.tagName.toLowerCase()
    const id = element.id ? `#${element.id}` : ''
    const className = element.getAttribute('class') ?? ''
    const classes = className
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 3)
      .map((name) => `.${name}`)
      .join('')
    const label =
      (element.textContent ?? '').replace(/\s+/g, ' ').trim().slice(0, 40) ||
      element.getAttribute('aria-label') ||
      ''
    return `${tag}${id}${classes}${label ? ` "${label}"` : ''}`
  }

  const isInlineProseLink = (element: Element): boolean => {
    if (element.tagName !== 'A') return false
    if (!getComputedStyle(element).display.startsWith('inline')) return false
    const parent = element.parentElement
    if (!parent) return false
    return Array.from(parent.childNodes).some(
      (node) => node.nodeType === Node.TEXT_NODE && (node.textContent ?? '').trim() !== '',
    )
  }

  /**
   * The box a person actually presses to activate `element`.
   *
   * A form control is activated by its `<label>` as well as by itself, so the
   * label's box is the hit area whenever it is the larger of the two. The
   * pattern this exists for is a visually-hidden input wrapped in a large
   * clickable region — the dropzone is exactly that: a 1x1 `sr-only` file input
   * whose label is a 208px-tall zone. Measuring the input alone would report a
   * 1x1 touch target for a control nobody has ever had trouble hitting, and
   * "fixing" it would mean giving up the accessible name and the keyboard
   * behaviour the platform provides for free.
   */
  const activatingBox = (element: Element): DOMRect | null => {
    const labels =
      element instanceof HTMLInputElement ||
      element instanceof HTMLSelectElement ||
      element instanceof HTMLTextAreaElement
        ? Array.from(element.labels ?? [])
        : []

    let widest: DOMRect | null = null
    for (const label of labels) {
      const rect = label.getBoundingClientRect()
      if (widest === null || rect.width * rect.height > widest.width * widest.height) {
        widest = rect
      }
    }

    return widest
  }

  const round = (value: number): number => Math.round(value * 10) / 10

  const undersized: SmallTouchTarget[] = []

  for (const element of Array.from(document.querySelectorAll(INTERACTIVE))) {
    if (element instanceof HTMLInputElement && element.type === 'hidden') continue
    if (element.closest('[aria-hidden="true"]') !== null) continue
    if (element.closest('[inert]') !== null) continue

    const rect = element.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) continue
    if (getComputedStyle(element).visibility === 'hidden') continue

    // Half a pixel of slack so that a box laid out at exactly the minimum is
    // never failed by sub-pixel rounding.
    if (rect.width >= minSize - 0.5 && rect.height >= minSize - 0.5) continue

    const label = activatingBox(element)
    if (label !== null && label.width >= minSize - 0.5 && label.height >= minSize - 0.5) continue

    if (isInlineProseLink(element)) continue

    undersized.push({
      descriptor: describe(element),
      width: round(rect.width),
      height: round(rect.height),
    })
  }

  return undersized
}
