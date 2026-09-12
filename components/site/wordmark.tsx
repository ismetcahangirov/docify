import { cn } from '@/lib/utils'
import { SITE_NAME } from '@/lib/seo/site'

/*
 * The wordmark, and the brush behind its initial (issue #311).
 *
 * The mark is one text run — `Docify`, never a picture of the word — with the
 * first letter wrapped so that something can be drawn behind it: a stroke of
 * paint, and a thin light frame cutting across it. The pink is the one colour
 * in the palette that is not a grey; it arrives as `--color-brush` and is used
 * here and nowhere else, which is what keeps the rest of the system monochrome.
 *
 * ## The three rules a layer behind text has to obey
 *
 * `e2e/a11y.spec.ts` asserts that axe *evaluated* `color-contrast`, not merely
 * that it did not fail, and three separate things stop axe being able to run
 * that check. All three were learned building the hero's flowing curves (#294)
 * and all three apply here:
 *
 * 1. **No SVG.** axe abandons its walk of the elements under a text run on
 *    IMG, CANVAS, OBJECT, IFRAME, VIDEO or SVG and reports the check as
 *    incomplete. So the paint is `border-radius` on empty boxes, which axe
 *    walks straight over.
 * 2. **One box.** axe resolves each line of a run against the stack of elements
 *    under it and fails when the stacks differ. Every layer is therefore
 *    `inset-0` on the letter's box, and the shape that actually differs between
 *    them is drawn on `::before` — a pseudo-element is not in the flattened
 *    tree axe builds, so it has no rect and joins no stack.
 * 3. **Explicit paint order.** Two positioned elements with no `z-index` are
 *    painted in document order and axe's own sort does not always agree with
 *    the browser. The letter says `z-10`, the layers say `z-0`, and `isolate`
 *    keeps both numbers local to the mark.
 *
 * Rule 2 is also why the letter sits in a span of its own rather than being the
 * wrapper's text: inline content paints *below* a positioned descendant of the
 * same element, so a letter left bare would be buried under its own brush.
 *
 * ## One box at both sizes
 *
 * `leading-none` is not typographic here, it is geometric. The brush is
 * measured in `em` so that it grows with the mark at `md`, but the box it is
 * measured against is the letter's line box — and `h3` leads at 1.3 where the
 * `wordmark` step leads at 1. Left alone, the same frame would be square on a
 * laptop and a tall slot on a phone. Levelling the leading makes the two sizes
 * the same drawing.
 *
 * ## Colour
 *
 * The letter keeps the foreground it inherits. Near-black on `--color-brush` is
 * 5.5:1 — above AA — where the white of the reference would have been 3.5:1 and
 * below it. The frame is `fg-dark`, the palette's white, and carries no text.
 */

/**
 * What every layer has in common: the letter's own box, and one shape on
 * `::before`.
 *
 * The paint is a flat `--color-brush` fill cut to shape by a *mask* —
 * `--brush-image`, generated into `app/brand.css` by `pnpm brand:art`: a torn
 * outline with bristle drags and splatter that no arrangement of
 * `border-radius` was ever going to imitate. A mask is
 * the one way to use that drawing here: an `<img>`, an inline `<svg>` or a
 * `background-image` would each stop axe resolving what is behind the letter
 * (rule 1 above), while a masked element is a plain box with a background
 * colour — the drawing decides which of its pixels are painted, and the
 * element stays something axe can walk over. Prefixed alongside the standard
 * property for Safari, which still needs `-webkit-mask-*`.
 */
const LAYER = [
  'pointer-events-none absolute inset-0 z-0',
  "before:absolute before:content-[''] before:[inset:var(--brush-inset)]",
  'before:[rotate:var(--brush-rotate)]',
].join(' ')

/** The paint layers, cut to the brush drawing rather than to a rounded box. */
const PAINT = [
  'before:bg-brush',
  'before:[mask-image:var(--brush-image)] before:[-webkit-mask-image:var(--brush-image)]',
  'before:[mask-size:100%_100%] before:[-webkit-mask-size:100%_100%]',
  'before:[mask-repeat:no-repeat] before:[-webkit-mask-repeat:no-repeat]',
].join(' ')

/**
 * The stroke, in the order it is laid down: the body of the paint, a second
 * lighter pass turned against it so the two torn edges never line up, and the
 * frame over both.
 *
 * The geometry is in `em` throughout — the mark grows with the type scale at
 * `md`, and a pixel here would leave the paint behind at the larger size. It
 * travels as custom properties rather than as arbitrary utilities so that no
 * `url()` or percentage pair has to survive Tailwind's value parser.
 *
 * None of the four numbers in a layer matches its opposite, and that is the
 * point: they are measured from the *ink* of the D, not from its box. Archivo
 * sets the letter 1px in from the left of its advance and hangs it 3px below
 * the top of a line box led at 1, so insets symmetrical about the box would
 * leave the letter visibly high and left inside the frame. Each layer is
 * centred on the ink instead, which is also why the centring survives the step
 * up at `md` — ink and layer scale together.
 */
const LAYERS = [
  {
    key: 'paint',
    className: PAINT,
    inset: '-0.27em -0.41em -0.23em -0.38em',
    rotate: '-4deg',
  },
  {
    key: 'sweep',
    className: `${PAINT} before:opacity-45`,
    inset: '-0.17em -0.30em -0.13em -0.27em',
    rotate: '166deg',
  },
  {
    key: 'frame',
    className: 'before:border-2 before:border-fg-dark',
    inset: '-0.14em -0.26em -0.11em -0.27em',
    rotate: '-4deg',
  },
] as const

export function Wordmark({ className }: { className?: string }) {
  const initial = SITE_NAME.slice(0, 1)
  const rest = SITE_NAME.slice(1)

  return (
    <span data-slot="wordmark" className={cn('text-h3 leading-none md:text-wordmark', className)}>
      {/*
        The brush reaches past the letter on every side, and the right-hand
        side of it is the one that meets the next letter. The margin is what
        keeps the frame clear of the `O` — wide enough that the mark reads as a
        stamp set beside the word, narrow enough that it is still one word.
      */}
      <span className="relative isolate mr-[0.2em] inline-block">
        {LAYERS.map((layer) => (
          <span
            key={layer.key}
            data-slot="wordmark-brush"
            data-layer={layer.key}
            aria-hidden="true"
            className={cn(LAYER, layer.className)}
            style={
              {
                '--brush-inset': layer.inset,
                '--brush-rotate': layer.rotate,
              } as React.CSSProperties
            }
          />
        ))}
        {/*
          The tilt is on the letter and on the frame, never on a layer's own
          box: a rotated box has a bounding rect up to 40% larger than the box
          itself, and axe reads those rects to decide what is behind a line of
          text. The paint keeps its own angle, which is what stops the three
          edges lining up into one shape.
        */}
        <span data-slot="wordmark-initial" className="relative z-10 inline-block rotate-[-4deg]">
          {initial}
        </span>
      </span>
      {/*
        The brush's own span is positioned, and a positioned element paints
        above the inline text of its parent whatever the document order says.
        So the rest of the name is positioned too, one layer up: where the
        splatter reaches this far it passes *behind* the letters.
      */}
      <span className="relative z-10">{rest}</span>
    </span>
  )
}
