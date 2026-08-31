// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { layoutText, type PdfTextItem } from '@/lib/engines/pdf-text-layout'

/**
 * One text run at a position on the page.
 *
 * PDF's origin is the *bottom* left, so a larger `y` is higher up — which is why
 * the fixtures below count downwards.
 */
function run(text: string, x: number, y: number, options: Partial<PdfTextItem> = {}): PdfTextItem {
  return {
    str: text,
    transform: [10, 0, 0, 10, x, y],
    width: text.length * 5,
    height: 10,
    hasEOL: false,
    ...options,
  }
}

describe('layoutText', () => {
  it('joins the runs of one line in reading order', () => {
    // A line arrives as several runs because a font or a kerning adjustment
    // splits it, not because there is a break in the sentence.
    expect(layoutText([run('Hello', 100, 700), run(' world', 125, 700)])).toBe('Hello world')
  })

  it('reads a line left to right however the runs were emitted', () => {
    // Producers are free to write a page's content in any order, and some write
    // right-hand columns of a table before the left-hand ones.
    expect(layoutText([run('second', 200, 700), run('first ', 100, 700)])).toBe('first second')
  })

  it('reads lines down the page, since PDF measures up from the bottom', () => {
    // 700 is above 688. Ordering by ascending `y` would print the page upside
    // down, which is the mistake this coordinate system invites.
    expect(layoutText([run('bottom', 100, 688), run('top', 100, 700)])).toBe('top\nbottom')
  })

  it('inserts a space where the runs are set apart on the page', () => {
    // The gap is the only signal: neither run carries one, and running the words
    // together is the classic way extracted text comes out unreadable.
    expect(layoutText([run('Total', 100, 700), run('42', 400, 700)])).toBe('Total 42')
  })

  it('does not double a space the text already has', () => {
    expect(layoutText([run('Total ', 100, 700), run('42', 400, 700)])).toBe('Total 42')
    expect(layoutText([run('Total', 100, 700), run(' 42', 400, 700)])).toBe('Total 42')
  })

  it('keeps runs that touch as one word', () => {
    // `ffi` set as a ligature is its own run and belongs against its neighbours.
    expect(layoutText([run('of', 100, 700), run('fice', 110, 700)])).toBe('office')
  })

  it('treats a small vertical wobble as the same line', () => {
    // Subscripts, superscripts and a font swap all move the baseline slightly;
    // none of them starts a new line.
    expect(layoutText([run('H', 100, 700), run('2', 105, 697), run('O', 110, 700)])).toBe('H2O')
  })

  it('separates paragraphs with a blank line', () => {
    const text = layoutText([
      run('First paragraph.', 100, 700),
      run('Still the first.', 100, 688),
      run('A new one.', 100, 650),
    ])

    expect(text).toBe('First paragraph.\nStill the first.\n\nA new one.')
  })

  it('drops runs that carry nothing', () => {
    expect(layoutText([run('kept', 100, 700), run('', 200, 700), run('   ', 300, 700)])).toBe(
      'kept',
    )
  })

  it('is empty for a page with no text at all, such as a scan', () => {
    expect(layoutText([])).toBe('')
  })

  it('never leaves trailing whitespace on a line', () => {
    expect(layoutText([run('trailing   ', 100, 700), run('word', 100, 688)])).toBe('trailing\nword')
  })

  it('survives a run with no usable position rather than dropping the words', () => {
    const broken: PdfTextItem = {
      str: 'orphan',
      transform: [],
      width: Number.NaN,
      height: Number.NaN,
      hasEOL: false,
    }

    expect(layoutText([broken])).toBe('orphan')
  })
})
