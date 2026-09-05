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
 */
export function SiteHeader() {
  return (
    <header
      data-slot="site-header"
      className="mx-3 flex min-w-0 items-center justify-between gap-6 py-5 font-sans sm:mx-6"
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
