/**
 * How much two pages have in common.
 *
 * The measurement behind the uniqueness gate. Its runner is
 * `test/registry/copy.test.ts` rather than a command of its own: the copy it
 * measures is TypeScript, a plain `.mjs` entry point cannot import it, and a
 * gate that only runs when somebody remembers to type a command is not a gate.
 * Living in `scripts/` keeps it out of the application bundle graph, which is
 * the reason it is not a module under `lib/`.
 *
 * ## Why shingles rather than a word count
 *
 * Comparing bags of words says two pages about JPEG are similar, which they
 * are and should be — they are both about JPEG. What actually gets a
 * programmatic set discounted is *reused phrasing*: the same sentence with two
 * nouns swapped, a hundred and twenty times. A shingle is a window of four
 * consecutive words, so it survives a synonym and dies on a rewritten clause,
 * which is the distinction that matters here.
 *
 * ## Why Jaccard and not containment
 *
 * Containment (`|A ∩ B| / |A|`) punishes a short page next to a long one for
 * being short. Jaccard (`|A ∩ B| / |A ∪ B|`) treats the two symmetrically,
 * which is right when the question is "are these two the same page".
 */

/** Words per shingle. Four survives a synonym and dies on a rewritten clause. */
export const SHINGLE_SIZE = 4

/**
 * `text` as a list of comparable words.
 *
 * Case and punctuation are dropped, because "HEIC files" and "heic files." are
 * the same phrasing and counting them apart would flatter every page.
 */
export function words(text) {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean)
}

/** Every window of {@link SHINGLE_SIZE} consecutive words in `text`. */
export function shingles(text) {
  const tokens = words(text)
  const set = new Set()

  for (let i = 0; i + SHINGLE_SIZE <= tokens.length; i += 1) {
    set.add(tokens.slice(i, i + SHINGLE_SIZE).join(' '))
  }

  return set
}

/**
 * The Jaccard similarity of two shingle sets, in `0..1`.
 *
 * Two pages with nothing in common score 0; two identical pages score 1. Two
 * empty pages score 0 rather than 1 — an empty page is a bug, and reporting it
 * as maximally duplicated would bury the real duplicates behind it.
 */
export function similarity(a, b) {
  if (a.size === 0 || b.size === 0) return 0

  let shared = 0
  const [small, large] = a.size <= b.size ? [a, b] : [b, a]

  for (const shingle of small) if (large.has(shingle)) shared += 1

  return shared / (a.size + b.size - shared)
}

/**
 * Every pair of pages that is more alike than `limit`, worst first.
 *
 * `pages` is `[id, text]` entries. O(n²) in the number of pages, which at a few
 * hundred is milliseconds and is not worth a minhash to avoid.
 */
export function tooSimilar(pages, limit) {
  const prepared = pages.map(([id, text]) => [id, shingles(text)])
  const found = []

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      const score = similarity(prepared[i][1], prepared[j][1])
      if (score > limit) found.push({ a: prepared[i][0], b: prepared[j][0], score })
    }
  }

  return found.sort((x, y) => y.score - x.score)
}

/** The highest similarity between any two of `pages`, or 0 with fewer than two. */
export function worstOverlap(pages) {
  const prepared = pages.map(([, text]) => shingles(text))
  let worst = 0

  for (let i = 0; i < prepared.length; i += 1) {
    for (let j = i + 1; j < prepared.length; j += 1) {
      worst = Math.max(worst, similarity(prepared[i], prepared[j]))
    }
  }

  return worst
}
