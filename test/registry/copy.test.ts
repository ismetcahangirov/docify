// @vitest-environment node

/**
 * The copy for all 124 conversion pages (issue #69).
 *
 * Two kinds of assertion here, and the second is the one that matters.
 *
 * The per-page rules — a distinct heading, forty to seventy words of
 * introduction, three steps, four questions, a note — are mechanical, and they
 * exist because a rule written only in a style guide holds for the first thirty
 * pages and not the hundredth.
 *
 * The uniqueness measurement is the real gate. Google discounts a programmatic
 * set for reused phrasing, and reused phrasing is invisible while you are
 * writing it: every page reads fine on its own. Only a pairwise comparison
 * catches the template.
 */

import { describe, expect, it } from 'vitest'

import { copyFor, copyText, PAIR_COPY } from '@/lib/registry/copy'
import {
  MAX_INTRO_WORDS,
  MAX_OVERLAP,
  MIN_INTRO_WORDS,
  MIN_QUESTIONS,
} from '@/lib/registry/copy/types'
import { PAIRS } from '@/lib/registry/pairs'
import { tooSimilar, worstOverlap } from '../../scripts/check-content-uniqueness/overlap.mjs'

const entries = Object.entries(PAIR_COPY)

const wordCount = (text: string) => text.trim().split(/\s+/).filter(Boolean).length

describe('the copy set and the pair catalogue agree', () => {
  it('has words for every pair that has a page', () => {
    const missing = PAIRS.filter((pair) => copyFor(pair.slug) === undefined).map(
      (pair) => pair.slug,
    )

    expect(missing).toEqual([])
  })

  it('has no words for a page that does not exist', () => {
    const known = new Set(PAIRS.map((pair) => pair.slug))
    const orphaned = Object.keys(PAIR_COPY).filter((slug) => !known.has(slug))

    expect(orphaned).toEqual([])
  })

  it('answers undefined for a slug it does not know', () => {
    expect(copyFor('heic-to-doc')).toBeUndefined()
  })
})

describe('every page meets the copy bar', () => {
  it.each(entries)('%s: has a heading of its own', (_slug, copy) => {
    expect(copy.h1.length).toBeGreaterThan(20)
  })

  it('gives no two pages the same heading', () => {
    const headings = entries.map(([, copy]) => copy.h1)

    expect(new Set(headings).size).toBe(headings.length)
  })

  it.each(entries)('%s: introduces itself in 40 to 70 words', (_slug, copy) => {
    const count = wordCount(copy.intro)

    expect(count).toBeGreaterThanOrEqual(MIN_INTRO_WORDS)
    expect(count).toBeLessThanOrEqual(MAX_INTRO_WORDS)
  })

  it.each(entries)('%s: gives exactly three steps, each a real instruction', (_slug, copy) => {
    expect(copy.steps).toHaveLength(3)

    for (const step of copy.steps) expect(wordCount(step)).toBeGreaterThan(5)
  })

  it.each(entries)('%s: answers at least four questions', (_slug, copy) => {
    expect(copy.faq.length).toBeGreaterThanOrEqual(MIN_QUESTIONS)

    for (const { q, a } of copy.faq) {
      expect(q.endsWith('?')).toBe(true)
      expect(wordCount(a)).toBeGreaterThan(10)
    }
  })

  it.each(entries)('%s: asks each question only once', (_slug, copy) => {
    const questions = copy.faq.map((question) => question.q)

    expect(new Set(questions).size).toBe(questions.length)
  })

  it.each(entries)('%s: carries a technical note about this pair', (_slug, copy) => {
    expect(wordCount(copy.note)).toBeGreaterThan(20)
  })

  /*
   * The design gate refuses U+2190-U+21FF anywhere it can reach, because the
   * self-hosted latin subset has no glyph for them. Copy is rendered text like
   * any other, so the same rule applies to it.
   */
  it.each(entries)('%s: writes no arrow as a text character', (_slug, copy) => {
    expect(copyText(copy)).not.toMatch(/[←-⇿]/u)
  })
})

describe('no two pages are the same page', () => {
  const pages: Array<[string, string]> = entries.map(([slug, copy]) => [slug, copyText(copy)])

  it('keeps every pairing below the overlap ceiling', () => {
    const duplicates = tooSimilar(pages, MAX_OVERLAP)

    expect(
      duplicates.map(({ a, b, score }) => `${a} / ${b} at ${(score * 100).toFixed(1)}%`),
    ).toEqual([])
  })

  /*
   * Reported as well as asserted. The ceiling is 40%; the point of writing the
   * copy by hand rather than from a template is to land far below it, and a
   * number creeping towards the limit is the early warning that somebody has
   * started filling in blanks.
   */
  it('lands well clear of the ceiling rather than just under it', () => {
    expect(worstOverlap(pages)).toBeLessThan(MAX_OVERLAP / 2)
  })

  it('measures every page against every other one', () => {
    expect(pages.length).toBe(PAIRS.length)
  })
})
