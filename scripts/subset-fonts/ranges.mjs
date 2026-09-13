/**
 * The codepoint arithmetic behind the two-file split of every self-hosted
 * family (issue #315).
 *
 * A range is `[first, last]`, inclusive, and a list of them is always sorted
 * and non-overlapping. That is the only shape any function here accepts or
 * returns, so the CSS string, the character list handed to the subsetter and
 * the assertions in `test/subset-fonts.test.ts` are all derived from the same
 * two declarations below rather than restated three times.
 */

/**
 * @typedef {readonly [number, number]} Range An inclusive codepoint range.
 */

/**
 * Google's `latin` subset — the coverage of the three woff2 files vendored in
 * `assets/fonts/`, written as the `unicode-range` Google's own stylesheet
 * declares for it.
 *
 * It is the *whole* of what those files contain (230 codepoints across the
 * three of them), and therefore the whole of what the two halves below have to
 * account for between them.
 */
export const LATIN = /** @type {readonly Range[]} */ ([
  [0x0000, 0x00ff],
  [0x0131, 0x0131],
  [0x0152, 0x0153],
  [0x02bb, 0x02bc],
  [0x02c6, 0x02c6],
  [0x02da, 0x02da],
  [0x02dc, 0x02dc],
  [0x0304, 0x0304],
  [0x0308, 0x0308],
  [0x0329, 0x0329],
  [0x2000, 0x206f],
  [0x2074, 0x2074],
  [0x20ac, 0x20ac],
  [0x2122, 0x2122],
  [0x2191, 0x2191],
  [0x2193, 0x2193],
  [0x2212, 0x2212],
  [0x2215, 0x2215],
  [0xfeff, 0xfeff],
  [0xfffd, 0xfffd],
])

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
 * `minuend` with every codepoint of `subtrahend` removed, renormalised into the
 * fewest ranges that describe the result.
 *
 * Written over the codepoints rather than over the interval endpoints because
 * the lists here are a few hundred entries long and the endpoint arithmetic is
 * where this kind of function is usually wrong.
 *
 * @param {readonly Range[]} minuend
 * @param {readonly Range[]} subtrahend
 * @returns {Range[]}
 */
export function subtractRanges(minuend, subtrahend) {
  const removed = new Set(codepointsOf(subtrahend))
  /** @type {Range[]} */
  const result = []

  for (const codepoint of codepointsOf(minuend)) {
    if (removed.has(codepoint)) continue

    const last = result.at(-1)

    if (last !== undefined && last[1] === codepoint - 1)
      result[result.length - 1] = [last[0], codepoint]
    else result.push([codepoint, codepoint])
  }

  return result
}

/**
 * The half that is not preloaded: the rest of the vendored coverage, fetched
 * only when a page actually renders a character in it.
 */
export const EXTENDED = subtractRanges(LATIN, CORE)

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
