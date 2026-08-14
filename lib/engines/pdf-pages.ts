/**
 * Page-range parsing, shared by every PDF operation that takes one.
 *
 * Splitting and rendering both accept `"1-3, 7, 12-"` from the user, and two
 * implementations of that grammar would eventually disagree about whether `3-1`
 * is an error or a reversed span. One module, one answer.
 *
 * The whole file is pure: no pdf-lib, no pdf.js, nothing to load. It is safe to
 * import statically from anywhere, including a test that never opens a PDF.
 */

/** A contiguous span of 1-based page numbers, inclusive at both ends. */
export interface PageSpan {
  from: number
  to: number
}

/**
 * Parses a 1-based range spec against a document of `pageCount` pages and
 * answers with the spans it names, in the order they were written.
 *
 * Grammar, deliberately small:
 *
 * - `5`      — one page
 * - `2-6`    — an inclusive span
 * - `9-`     — from a page to the end
 * - `-4`     — from the start to a page
 * - comma or whitespace separated, in any mixture
 *
 * Order is preserved and overlaps are kept: `"3, 1-2, 3"` is three spans, in
 * that sequence. A caller that wants each page once asks for {@link pageIndices}
 * instead. Anything the grammar does not cover throws with the offending text
 * quoted, because a silently ignored range loses pages the user asked for.
 */
export function parsePageSpans(spec: string, pageCount: number): PageSpan[] {
  if (pageCount < 1) throw new Error('The document has no pages to select from.')

  const parts = spec
    // Space around the hyphen first: "1 - 3" is a natural way to write a range,
    // and splitting on whitespace before closing it up turns that into three
    // tokens and a rejection of well-formed input.
    .replace(/\s*-\s*/g, '-')
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0)

  if (parts.length === 0) {
    throw new Error(`"${spec}" names no pages. Use a range such as "1-3, 7".`)
  }

  return parts.map((part) => parseSpan(part, spec, pageCount))
}

/**
 * The 0-based page indices `spec` names, ascending and without duplicates —
 * the form pdf-lib's `copyPages` and pdf.js's `getPage` both want.
 *
 * Deduplicating is right for "which pages does this job touch"; it is wrong for
 * "which documents does a split produce", so splitting keeps the spans.
 */
export function pageIndices(spec: string, pageCount: number): number[] {
  const seen = new Set<number>()

  for (const span of parsePageSpans(spec, pageCount)) {
    for (let page = span.from; page <= span.to; page += 1) seen.add(page - 1)
  }

  return [...seen].sort((a, b) => a - b)
}

/** Every page of the document, 0-based — the "no range given" answer. */
export function allPageIndices(pageCount: number): number[] {
  return Array.from({ length: pageCount }, (_, index) => index)
}

function parseSpan(part: string, spec: string, pageCount: number): PageSpan {
  const match = /^(\d+)$|^(\d*)-(\d*)$/.exec(part)

  if (match === null || part === '-') {
    throw new Error(`"${part}" is not a page or a range. Write ranges like "1-3, 7" or "9-".`)
  }

  const [, single, open, close] = match

  const from = single ?? (open === '' ? '1' : open)
  const to = single ?? (close === '' ? String(pageCount) : close)

  const span = { from: page(from, part, spec, pageCount), to: page(to, part, spec, pageCount) }

  if (span.from > span.to) {
    // Not read as "reverse these pages": a descending span is far more often a
    // typo, and quietly emitting nothing for it drops pages from the output.
    throw new Error(`"${part}" ends before it starts. Write the lower page first, as "1-3".`)
  }

  return span
}

function page(value: string, part: string, spec: string, pageCount: number): number {
  const parsed = Number(value)

  // Separated from the range check below so a 30-digit numeral is not reported
  // as "page numbers start at 1", which is true and useless. `isSafeInteger`
  // rather than `isInteger`: past 2^53 the parse is already lossy.
  if (!Number.isSafeInteger(parsed)) {
    throw new Error(`"${value}" is too large to be a page number.`)
  }

  if (parsed < 1) {
    throw new Error(`Page numbers start at 1, but "${part}" asks for page ${value}.`)
  }

  if (parsed > pageCount) {
    // Quoting both the request and the document is what makes this actionable:
    // "page 12 of 9" tells the user which end of the mismatch to fix.
    throw new Error(
      `"${spec}" asks for page ${parsed}, but the document has ${pageCount} ` +
        `page${pageCount === 1 ? '' : 's'}.`,
    )
  }

  return parsed
}
