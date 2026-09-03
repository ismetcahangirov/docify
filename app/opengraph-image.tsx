import { ImageResponse } from 'next/og'

import { OG_SIZE, siteCard } from '@/lib/seo/og'
import { OgCardImage } from '@/lib/seo/og-card'

/*
 * The card every page inherits (issue #72).
 *
 * The App Router's metadata cascade puts this on `/`, on `/convert` and on
 * anything added later, and `app/convert/[pair]/opengraph-image.tsx` overrides
 * it for the hundred and twenty-four pages that have something specific to say.
 * Without it those other pages would declare `twitter:card=summary_large_image`
 * and then supply no large image, which previews as a grey rectangle.
 */

export const size = OG_SIZE
export const contentType = 'image/png'
export const alt = siteCard().alt

export default function Image() {
  return new ImageResponse(<OgCardImage card={siteCard()} />, { ...OG_SIZE })
}
