/**
 * Turning a page's text runs back into lines and paragraphs.
 *
 * ## Why this is not just concatenation
 *
 * A PDF does not store text. It stores instructions to draw glyphs at
 * coordinates, and pdf.js hands those back as *runs*: a run is however many
 * characters happened to be drawn by one instruction, which is a function of
 * font changes, kerning adjustments and the whims of the producer. A single
 * printed line routinely arrives as a dozen runs, in whatever order the content
 * stream wrote them — some producers emit a table's right-hand column first.
 * There are no line breaks and no spaces between runs, only positions.
 *
 * So the words are recovered from geometry. Runs at the same height are one
 * line, sorted left to right; a horizontal gap between two runs is a space; a
 * vertical gap larger than a line is a paragraph break. Every threshold below is
 * relative to the text's own size, because a footnote and a heading on the same
 * page have different ideas of how far apart "far apart" is.
 *
 * ## What it deliberately does not attempt
 *
 * Columns, tables and reading order across a multi-column layout. A two-column
 * page comes out with its columns interleaved line by line, which is what every
 * geometric extractor does and what `pdftotext` does without `-layout`. Doing
 * better needs a page segmentation model, and pretending otherwise would be
 * worse than the honest limitation — see the `LAYOUT_LOSS` warning the router
 * attaches to every text conversion.
 *
 * Pure, and free of pdf.js: {@link PdfTextItem} is a structural description of
 * what `getTextContent()` returns, so the whole of this can be proved against
 * fixtures a reader can check by eye.
 */

/** One run of text, as pdf.js reports it. */
export interface PdfTextItem {
  str: string
  /**
   * The text matrix `[a, b, c, d, e, f]`. Only `e` and `f` — the position — are
   * read; the scale is already reflected in {@link width} and {@link height}.
   *
   * PDF's origin is the *bottom* left corner, so a larger `f` is higher up the
   * page. Every comparison below is written the right way round for that.
   */
  transform: readonly number[]
  /** The run's width in the same units as the position. */
  width: number
  /** The run's height, which stands in for the font size. */
  height: number
  /** pdf.js's own opinion that a line ended here. Advisory; geometry decides. */
  hasEOL: boolean
}

/**
 * How far a run's baseline may sit from a line's before it counts as a new line,
 * as a share of the text height.
 *
 * A subscript, a superscript and a font swap all nudge the baseline by a few
 * per cent of the size. Half the height is comfortably above all three and
 * comfortably below the distance to the next line, which is at least the height
 * itself.
 */
const SAME_LINE_SHARE = 0.5

/**
 * A gap wider than this share of the text height is a space between words.
 *
 * A quarter of the size is roughly the width of a space in most text faces, and
 * being a *share* is the point: the same absolute gap is a word break in a
 * footnote and a kerning adjustment in a display heading.
 */
const SPACE_SHARE = 0.25

/**
 * A drop larger than this multiple of the line height starts a new paragraph.
 *
 * Consecutive lines of body text are set 1.1 to 1.3 times their size apart, so
 * 1.6 clears ordinary leading and still catches the extra space before a heading
 * or between paragraphs.
 */
const PARAGRAPH_MULTIPLE = 1.6

/** A fallback size for a run whose geometry is missing or unreadable. */
const DEFAULT_HEIGHT = 10

interface PlacedRun {
  text: string
  x: number
  y: number
  width: number
  height: number
}

/**
 * The page's text, as lines separated by newlines and paragraphs by a blank
 * line.
 *
 * Never ends with whitespace, and never contains a trailing space on a line: a
 * run's own padding is the producer's business and not something to carry into a
 * text file.
 */
export function layoutText(items: readonly PdfTextItem[]): string {
  const runs = items.map(place).filter((run) => run.text.trim().length > 0)
  if (runs.length === 0) return ''

  return paragraphs(groupIntoLines(runs))
}

function place(item: PdfTextItem): PlacedRun {
  const height = usable(item.height) ?? DEFAULT_HEIGHT

  return {
    text: item.str,
    // A run with no readable position is placed at the origin rather than
    // dropped: its words are still the user's words, and a document that
    // produces one is damaged rather than empty.
    x: usable(item.transform[4]) ?? 0,
    y: usable(item.transform[5]) ?? 0,
    width: usable(item.width) ?? 0,
    height,
  }
}

/**
 * Buckets runs into lines by height, then orders the lines down the page and the
 * runs within each line left to right.
 *
 * Reading order is imposed here rather than trusted, because the content stream
 * is free to draw a page in any sequence at all.
 */
function groupIntoLines(runs: readonly PlacedRun[]): PlacedRun[][] {
  const descending = [...runs].sort((a, b) => b.y - a.y)
  const lines: PlacedRun[][] = []

  for (const run of descending) {
    const current = lines.at(-1)
    const anchor = current?.[0]

    if (
      current !== undefined &&
      anchor !== undefined &&
      Math.abs(anchor.y - run.y) <= anchor.height * SAME_LINE_SHARE
    ) {
      current.push(run)
      continue
    }

    lines.push([run])
  }

  for (const line of lines) line.sort((a, b) => a.x - b.x)

  return lines
}

/** Joins the lines, inserting a blank one wherever the page left a gap. */
function paragraphs(lines: readonly PlacedRun[][]): string {
  const out: string[] = []

  for (const [index, line] of lines.entries()) {
    const previous = lines[index - 1]
    if (previous !== undefined && startsParagraph(previous, line)) out.push('')

    out.push(joinLine(line))
  }

  return out.join('\n')
}

function startsParagraph(previous: readonly PlacedRun[], line: readonly PlacedRun[]): boolean {
  const height = Math.max(previous[0].height, line[0].height)

  return previous[0].y - line[0].y > height * PARAGRAPH_MULTIPLE
}

/**
 * One line's runs, with a space wherever the page left one.
 *
 * The gap is measured from the end of the previous run to the start of the next,
 * so two runs that touch — a ligature split out of its word, a font change mid
 * word — are joined without one.
 */
function joinLine(line: readonly PlacedRun[]): string {
  let text = ''
  let endsAt = Number.NEGATIVE_INFINITY

  for (const run of line) {
    const gap = run.x - endsAt
    const needsSpace =
      text.length > 0 &&
      gap > run.height * SPACE_SHARE &&
      !/\s$/.test(text) &&
      !/^\s/.test(run.text)

    text += needsSpace ? ` ${run.text}` : run.text
    endsAt = run.x + run.width
  }

  return text.replace(/\s+$/, '')
}

function usable(value: number | undefined): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}
