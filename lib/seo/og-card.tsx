import type { OgCard } from './og'
import { OG_FG_DARK, OG_FG_DARK_MUT, OG_INK, OG_INK_2, OG_LINE_DARK } from './og-theme'
import { SITE_NAME } from './site'

/**
 * The picture on a social card, as the tree satori rasterises.
 *
 * ## Why everything is an inline style
 *
 * Not a preference. `next/og` renders this with satori, which implements a
 * subset of flexbox over inline styles and has no stylesheet, no cascade and no
 * class names. Tailwind utilities and `var(--color-…)` are both inert here, so
 * the design tokens arrive as the literals in `./og-theme` — the one place
 * outside `app/globals.css` allowed to name a colour, and the one the token test
 * checks against it.
 *
 * Every container also carries `display: flex` explicitly. Satori's default is
 * flex for anything with children and it *throws* on a block-level element with
 * more than one child rather than laying it out, which is a build failure with a
 * message about the wrong thing.
 *
 * ## The layout
 *
 * The hero block of a conversion page, at card proportions: an eyebrow naming
 * the family, the pair itself at display size, the page's own opening sentence
 * under it, and the promise along the bottom behind a hairline. A reader
 * scrolling a timeline sees the second line and nothing else, which is why the
 * pair is the second line.
 *
 * The card is 1200 × 630 and is shown at perhaps 500 px wide in a feed, so
 * nothing on it is smaller than 24 px — a caption at that scale is a smudge.
 */
export function OgCardImage({ card }: { card: OgCard }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        backgroundColor: OG_INK,
        color: OG_FG_DARK,
        padding: 72,
        // The inset border is the design system's one surface treatment: flat
        // fill, one hairline, no shadow (CLAUDE.md §3).
        border: `1px solid ${OG_LINE_DARK}`,
      }}
    >
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 26,
            letterSpacing: 5,
            color: OG_FG_DARK_MUT,
            textTransform: 'uppercase',
          }}
        >
          {card.eyebrow}
        </div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <div
          style={{
            fontSize: 104,
            lineHeight: 1,
            letterSpacing: -3,
            textTransform: 'uppercase',
          }}
        >
          {card.headline}
        </div>
        <div
          style={{
            display: 'flex',
            marginTop: 32,
            maxWidth: 880,
            fontSize: 30,
            lineHeight: 1.45,
            color: OG_FG_DARK_MUT,
          }}
        >
          {card.subline}
        </div>
      </div>

      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderTop: `1px solid ${OG_LINE_DARK}`,
          paddingTop: 28,
          fontSize: 26,
        }}
      >
        <div
          style={{
            display: 'flex',
            backgroundColor: OG_INK_2,
            padding: '10px 20px',
            letterSpacing: 3,
            textTransform: 'uppercase',
          }}
        >
          {SITE_NAME}
        </div>
        <div style={{ display: 'flex', color: OG_FG_DARK_MUT }}>{card.footer}</div>
      </div>
    </div>
  )
}
