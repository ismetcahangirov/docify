import { ImageResponse } from 'next/og'

import { PAIR_SLUGS, pairBySlug } from '@/lib/registry/pairs'
import { OG_SIZE, ogCard, siteCard } from '@/lib/seo/og'
import { OgCardImage } from '@/lib/seo/og-card'

/*
 * One social card per conversion (issue #72).
 *
 * ## Why one per pair rather than one for the site
 *
 * A link to a conversion page is shared in a thread where somebody is being
 * told which converter to use, and the preview is most of what they read. A
 * single site-wide card makes a hundred and twenty-four different answers look
 * identical; a card that says HEIC to JPG answers the question before the link
 * is clicked. It is also the difference between a search result with a rich
 * preview and one without, on a site whose entire acquisition is search.
 *
 * ## Why they are generated at build time
 *
 * `generateStaticParams` is repeated here rather than inherited. A metadata
 * image route under a dynamic segment is a route of its own, and without its
 * own parameter list Next.js renders each card on demand — booting satori and
 * resvg inside a request, on a page that is otherwise entirely static. All 124
 * are written during `next build` instead, next to the pages they belong to.
 *
 * ## Why there is no `alt` here, and no `generateImageMetadata`
 *
 * The alternative text has to name the conversion, and a per-route constant
 * cannot see the parameter. `generateImageMetadata` can — but it nests the
 * route under a second parameter (`opengraph-image/[__metadata_id__]`) that
 * `generateStaticParams` has no way to enumerate, and Next.js then refuses to
 * close the route and falls back to rendering every card on request. So the
 * page declares its own `openGraph.images` in `generateMetadata` instead, with
 * the URL and the alt text both coming from `lib/seo/og`. That is also the more
 * honest arrangement: the alt text is metadata about the page, and it is now
 * written where the rest of the page's metadata is.
 *
 * The drawing is in `lib/seo/og-card`, the words in `lib/seo/og` — see the
 * header there for why the two are apart.
 */

export const size = OG_SIZE
export const contentType = 'image/png'

/** Nothing outside the catalogue has a card, for the same reason it has no page. */
export const dynamicParams = false

/** Every card in the catalogue, written during `next build`. */
export function generateStaticParams(): Array<{ pair: string }> {
  return PAIR_SLUGS.map((pair) => ({ pair }))
}

export default async function Image({ params }: { params: Promise<{ pair: string }> }) {
  const { pair: slug } = await params
  const pair = pairBySlug(slug)
  const card = pair === undefined ? undefined : ogCard(pair)

  // The catalogue test proves every pair has copy. The site card is the fallback
  // so that a missing paragraph is a slightly generic preview rather than a
  // failed build.
  return new ImageResponse(<OgCardImage card={card ?? siteCard()} />, { ...OG_SIZE })
}
