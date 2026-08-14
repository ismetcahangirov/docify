// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { allPageIndices, pageIndices, parsePageSpans } from '@/lib/engines/pdf-pages'

describe('parsePageSpans', () => {
  it('reads a single page as a one-page span', () => {
    expect(parsePageSpans('5', 10)).toEqual([{ from: 5, to: 5 }])
  })

  it('reads an inclusive span', () => {
    expect(parsePageSpans('2-6', 10)).toEqual([{ from: 2, to: 6 }])
  })

  it('reads an open end as "to the last page"', () => {
    expect(parsePageSpans('9-', 12)).toEqual([{ from: 9, to: 12 }])
  })

  it('reads an open start as "from the first page"', () => {
    expect(parsePageSpans('-4', 12)).toEqual([{ from: 1, to: 4 }])
  })

  it('accepts commas, spaces or both as separators', () => {
    expect(parsePageSpans('1-2, 5  7', 10)).toEqual([
      { from: 1, to: 2 },
      { from: 5, to: 5 },
      { from: 7, to: 7 },
    ])
  })

  it('keeps the order and the overlaps it was given', () => {
    // Split needs this: "3, 1-2, 3" is three output documents, in that order.
    expect(parsePageSpans('3, 1-2, 3', 5)).toEqual([
      { from: 3, to: 3 },
      { from: 1, to: 2 },
      { from: 3, to: 3 },
    ])
  })

  it('rejects a page beyond the end of the document, quoting both numbers', () => {
    expect(() => parsePageSpans('12', 9)).toThrow(/page 12.*9 pages/)
  })

  it('rejects page zero, because page numbers a user writes start at one', () => {
    expect(() => parsePageSpans('0-3', 9)).toThrow(/start at 1/)
  })

  it('rejects a descending span instead of quietly emitting nothing', () => {
    expect(() => parsePageSpans('3-1', 9)).toThrow(/ends before it starts/)
  })

  it('rejects text that is not a range at all', () => {
    expect(() => parsePageSpans('last', 9)).toThrow(/not a page or a range/)
    expect(() => parsePageSpans('-', 9)).toThrow(/not a page or a range/)
  })

  it('rejects an empty spec rather than treating it as "everything"', () => {
    // "Everything" has its own call — `allPageIndices` — and guessing here
    // would turn a UI bug into a full-document export the user never asked for.
    expect(() => parsePageSpans('   ', 9)).toThrow(/names no pages/)
  })

  it('rejects a document with no pages', () => {
    expect(() => parsePageSpans('1', 0)).toThrow(/no pages/)
  })
})

describe('pageIndices', () => {
  it('answers with 0-based indices', () => {
    expect(pageIndices('1-3', 10)).toEqual([0, 1, 2])
  })

  it('sorts and deduplicates, so a page is touched once', () => {
    expect(pageIndices('3, 1-2, 3', 10)).toEqual([0, 1, 2])
  })
})

describe('allPageIndices', () => {
  it('covers the whole document', () => {
    expect(allPageIndices(3)).toEqual([0, 1, 2])
  })

  it('is empty for a document with no pages', () => {
    expect(allPageIndices(0)).toEqual([])
  })
})
