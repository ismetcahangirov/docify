/**
 * The palette and type scale of the social cards, as literal values.
 *
 * The one file outside `app/globals.css` that names a colour, and the reason is
 * mechanical rather than stylistic. The cards are drawn by satori, inside
 * `next/og`: it lays out a tree of inline styles and rasterises it, with no
 * stylesheet, no cascade and no custom properties. `var(--color-ink)` there is
 * not a token — it is a string satori cannot resolve, and the shape it is on
 * renders transparent.
 *
 * So the values are transcribed, once, here. `test/seo/og-theme.test.ts`
 * asserts that every one of them equals the `@theme` token of the same name in
 * `app/globals.css`, which is the property the raw-hex prohibition in CLAUDE.md
 * §3 exists to protect: renaming or changing a token fails the suite rather than
 * leaving a card quietly off-brand. `scripts/design-lint/rules.mjs` names this
 * file as the one exception, for the same reason it names the stylesheet.
 *
 * ## The face
 *
 * There isn't one. `next/og` bundles Noto Sans and satori cannot read WOFF2,
 * which is the only format `public/fonts/` ships — a variable Archivo as WOFF2
 * is unreadable to it, and shipping a second copy as TTF would put a duplicate
 * of the display face in the repository purely for an image. The cards
 * therefore lean on layout, scale and the monochrome palette for their
 * identity, and not on the typeface. If Archivo ever ships as TTF this is the
 * file that would gain a `fonts` option.
 */

/** Dark section: the card's ground. `--color-ink`. */
export const OG_INK = '#0d0d0d'

/** Card on dark, used for the panel behind the headline. `--color-ink-2`. */
export const OG_INK_2 = '#171717'

/** Hairline on dark. `--color-line-dark`. */
export const OG_LINE_DARK = '#262626'

/** Primary text on dark. `--color-fg-dark`. */
export const OG_FG_DARK = '#fafaf9'

/** Secondary text on dark. `--color-fg-dark-mut`. */
export const OG_FG_DARK_MUT = '#9b9a96'

/**
 * Every colour on a card, keyed by the token it was copied from.
 *
 * The map is what the test iterates. A colour added below without a matching
 * `--color-*` token fails, and so does a token whose value moved.
 */
export const OG_COLOURS: Readonly<Record<string, string>> = {
  ink: OG_INK,
  'ink-2': OG_INK_2,
  'line-dark': OG_LINE_DARK,
  'fg-dark': OG_FG_DARK,
  'fg-dark-mut': OG_FG_DARK_MUT,
}
