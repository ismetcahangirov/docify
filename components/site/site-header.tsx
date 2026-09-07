import { SITE_NAME } from '@/lib/seo/site'

/*
 * The site header (issue #267): the wordmark and one link.
 *
 * Deliberately this small. The product has one destination — the catalogue —
 * and a navigation with one entry is a navigation, not a menu; a bar of links
 * to sections that do not exist would be decoration pretending to be a map.
 *
 * ## Why it sits on the shell rather than in a block
 *
 * The page below it is a stack of light and dark panels (docify-design §1), and
 * a header that was itself a panel would read as a first block of content,
 * the hero pushed down into second place. Set directly on the shell, the same
 * inset as the panels, it is the frame around the stack rather than part of
 * it. That also decides its colours: muted text on `shell` measures 4.41:1
 * and misses AA, so everything here is the full foreground.
 *
 * ## Plain anchors
 *
 * `/convert` is cross-origin isolated (see the header of `next.config.ts`),
 * and a `next/link` soft navigation would carry this document's isolation
 * across the boundary. Both links are whole-document loads on purpose.
 *
 * ## Why it declares a layer
 *
 * `relative z-10` is not about anything the header draws. A block below it may
 * carry a decorative layer — `components/blocks/flowing-paths.tsx` in the home
 * hero — built from elements far larger than the block that clips them. The
 * clip is only a clip: the elements' layout boxes still reach up here, and
 * anything reading the page geometrically reads them as covering the wordmark.
 * axe does exactly that, and reported `color-contrast` on both links as
 * *incomplete* — "overlapped by another element" — which `e2e/a11y.spec.ts`
 * treats as the failure it is.
 *
 * Saying the frame sits above the page's decoration is true, is what a reader
 * already assumes, and costs one class. The alternative was to shrink the
 * decoration until its boxes fitted inside their own block, which would mean
 * choosing the composition of a hero from up here.
 */
export function SiteHeader() {
  return (
    <header
      data-slot="site-header"
      // The same inset as the blocks below, and the same gutter inside it, so
      // the wordmark's first letter lines up with the hero heading's.
      className="relative z-10 mx-3 flex min-w-0 items-center justify-between gap-6 px-6 py-5 font-sans sm:mx-6 sm:px-10"
    >
      <a
        href="/"
        aria-label={`${SITE_NAME} home`}
        className={[
          '-mx-2 inline-flex min-h-11 items-center px-2',
          'font-display text-h3 uppercase',
          'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
        ].join(' ')}
      >
        {SITE_NAME}
      </a>

      <nav aria-label="Site">
        <a
          href="/convert"
          className={[
            '-mx-2 inline-flex min-h-11 items-center px-2',
            'text-body underline-offset-4 hover:underline',
            'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
          ].join(' ')}
        >
          Converters
        </a>
      </nav>
    </header>
  )
}
