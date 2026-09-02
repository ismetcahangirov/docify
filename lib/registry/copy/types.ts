/**
 * The shape of one conversion page's words.
 *
 * Every field here is on screen and in the structured data: the heading is the
 * `<h1>`, the steps become a `HowTo`, the questions become a `FAQPage`, and the
 * note is the paragraph that stops the page being a template with two nouns
 * swapped.
 *
 * ## Why the constraints are constants and not a comment
 *
 * `test/registry/copy.test.ts` reads them. A rule written only in prose is a
 * rule that holds for the first thirty pages: the hundredth intro is nineteen
 * words because nobody counted. These are the numbers CI counts against.
 */

/** One question a person actually asks about this specific conversion. */
export interface PairQuestion {
  q: string
  a: string
}

export interface PairCopy {
  /**
   * The page's `<h1>`.
   *
   * Distinct per pair, and not "Convert X to Y" with the letters changed — that
   * is the template Google discounts a hundred pages for at once. It leads with
   * whatever is actually true about *this* conversion.
   */
  h1: string
  /**
   * The opening paragraph: 40-70 words on why somebody performs this
   * conversion, not on what a converter is.
   */
  intro: string
  /** Exactly three, because a `HowTo` with a variable number of steps reads as filler. */
  steps: readonly [string, string, string]
  /** Four or more, each specific enough that the answer could not be reused. */
  faq: readonly PairQuestion[]
  /**
   * The technical fact that only this pair has.
   *
   * The field that carries the uniqueness bar. "HEIC has been the iPhone
   * default since 2017 and Windows cannot open it natively" is a note; "the
   * conversion is fast and free" is not.
   */
  note: string
}

/** The shortest an introduction may be, in words. */
export const MIN_INTRO_WORDS = 40

/** The longest. Past this it stops being an introduction. */
export const MAX_INTRO_WORDS = 70

/** The fewest questions a page may answer. */
export const MIN_QUESTIONS = 4

/**
 * The most any two pages may have in common, as a fraction.
 *
 * Measured over four-word shingles across the whole of a page's copy — see
 * `scripts/check-content-uniqueness`. Forty percent is the number the SEO skill
 * sets, and it is generous: genuinely pair-specific copy lands far below it,
 * and anything approaching it is a template with the nouns swapped.
 */
export const MAX_OVERLAP = 0.4
