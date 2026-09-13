/**
 * The half of every self-hosted family that is preloaded (issue #315).
 *
 * One declaration, `CORE`, and everything else here is derived from it: the
 * `unicode-range` the core faces in `app/fonts.ts` declare, the characters the
 * subsetter is asked to keep, and the set the assertions in
 * `test/subset-fonts.test.ts` check the shipped files against.
 *
 * `EXTENDED` names the other half for the stylesheet, but nothing is *cut* from
 * it: `cli.mjs` derives each extended file from its source font's own cmap, and
 * the test asserts the two agree. The first version of this did cut from a
 * written-down range — Google's published `latin` minus `CORE` — and silently
 * lost the six codepoints the files carry that the published range does not
 * name.
 *
 * A range is `[first, last]`, inclusive, and a list of them is always sorted
 * and non-overlapping.
 */

/**
 * @typedef {readonly [number, number]} Range An inclusive codepoint range.
 */

/**
 * The half that is preloaded: every printable ASCII character, plus the five
 * non-ASCII characters this site's own pages render and the two spaces and
 * quotes an editor reaches for without thinking.
 *
 * Printable ASCII is in whole rather than character by character on purpose. A
 * subset tuned to the sentences that exist today would send the next em-dash
 * somebody types to the metric-adjusted fallback face, and nothing would say
 * so — the page would simply be set in two typefaces.
 *
 * Measured against the 260 prerendered documents on 2026-09-13: they use 82
 * distinct codepoints, and the only ones above U+007E are © — ’ “ ”.
 *
 * U+2192 is deliberately absent, and is absent from the vendored files too:
 * `scripts/design-lint/` refuses the whole U+2190–U+21FF block as a text glyph,
 * so the primary button's arrow is an inline SVG. See `app/fonts.ts`.
 */
export const CORE = /** @type {readonly Range[]} */ ([
  [0x0020, 0x007e],
  [0x00a0, 0x00a0],
  [0x00a9, 0x00a9],
  [0x00ab, 0x00ab],
  [0x00bb, 0x00bb],
  [0x00d7, 0x00d7],
  [0x2013, 0x2014],
  [0x2018, 0x2019],
  [0x201c, 0x201d],
  [0x2026, 0x2026],
])

/**
 * The half that is not preloaded: everything else the three vendored files map.
 *
 * Written down here because a `@font-face` needs a literal, and *checked*
 * against the fonts: `test/subset-fonts.test.ts` asserts that this covers every
 * codepoint of every source file that `CORE` does not, and that the shipped
 * extended files map exactly the intersection. The subsetter never reads this
 * list — it derives each extended file from its source's own cmap — so the two
 * cannot silently disagree about what is in the file, only about what the
 * stylesheet claims, and that is what the assertion is for.
 *
 * It is declared at all rather than left off the `@font-face` because a face
 * with no `unicode-range` claims every codepoint in existence. That face would
 * be a candidate for ASCII during the core file's swap window, and for a
 * Japanese file name it has no glyph for — two ways to fetch 22kB that can
 * never be drawn.
 */
export const EXTENDED = /** @type {readonly Range[]} */ ([
  [0x0000, 0x0000],
  [0x000d, 0x000d],
  [0x00a1, 0x00a8],
  [0x00aa, 0x00aa],
  [0x00ac, 0x00ba],
  [0x00bc, 0x00d6],
  [0x00d8, 0x00ff],
  [0x0102, 0x0102],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x0300, 0x0301],
  [0x0303, 0x0304],
  [0x0308, 0x0309],
  [0x0323, 0x0323],
  [0x2002, 0x2002],
  [0x2009, 0x2009],
  [0x200b, 0x200b],
  [0x201a, 0x201a],
  [0x201e, 0x201e],
  [0x2022, 0x2022],
  [0x2032, 0x2033],
  [0x2039, 0x203a],
  [0x2044, 0x2044],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
])

/**
 * Every codepoint of a range list, ascending.
 *
 * @param {readonly Range[]} ranges
 * @returns {number[]}
 */
export function codepointsOf(ranges) {
  /** @type {number[]} */
  const codepoints = []

  for (const [first, last] of ranges) {
    for (let codepoint = first; codepoint <= last; codepoint += 1) codepoints.push(codepoint)
  }

  return codepoints.sort((a, b) => a - b)
}

/**
 * A range list as the `unicode-range` descriptor of a `@font-face`.
 *
 * @param {readonly Range[]} ranges
 * @returns {string}
 */
export function cssUnicodeRange(ranges) {
  return ranges
    .map(([first, last]) => {
      const from = first.toString(16).toUpperCase()

      return first === last ? `U+${from}` : `U+${from}-${last.toString(16).toUpperCase()}`
    })
    .join(', ')
}

/**
 * The descriptor the core faces in `app/fonts.ts` declare.
 *
 * The Next font loader evaluates its option objects at compile time and rejects
 * anything it cannot read statically, so `app/fonts.ts` cannot import this — it
 * carries the same string as an inline literal, and `test/app/fonts.test.ts`
 * asserts the two are the same so they cannot drift apart.
 */
export const CORE_UNICODE_RANGE = cssUnicodeRange(CORE)

/** The descriptor the extended faces declare. Same arrangement as the core one. */
export const EXTENDED_UNICODE_RANGE = cssUnicodeRange(EXTENDED)

/**
 * The characters of a range list, as the text the subsetter is asked to keep.
 *
 * @param {readonly Range[]} ranges
 * @returns {string}
 */
export function textOf(ranges) {
  return codepointsOf(ranges)
    .map((codepoint) => String.fromCodePoint(codepoint))
    .join('')
}

/**
 * The characters Next's metric-adjusted fallback is measured over, kept in the
 * extended files on top of what they are for.
 *
 * `getFallbackMetricsFromFontFile` derives `size-adjust` from the average
 * advance of the lowercase alphabet, and gives up — leaving 100% — if the file
 * is missing any of it. The extended half is the only face in each stack that
 * declares that fallback (see the header of `app/fonts.ts`), and the core half
 * owns every ASCII letter, so without these the correction Inter had before
 * this split (107.89%) would quietly become none at all and text would reflow
 * when the real face landed.
 *
 * They are ballast: `EXTENDED` does not claim U+0061–U+007A, so no character is
 * ever drawn from them.
 */
export const FALLBACK_METRIC_TEXT = ` ${textOf([[0x0061, 0x007a]])}`
