/**
 * Turns an `organize`/`rotate` request into a plan, or refuses it by name.
 *
 * Separate from `./pdf-organize` because this half touches no PDF: it is a pure
 * function of the options and the page count, so it can reject a bad request
 * before pdf-lib is asked to move anything. A half-applied reorder that then met
 * an impossible rotation would hand back a document the user neither recognises
 * nor can undo.
 *
 * Every rejection quotes the value that caused it and says what to do instead —
 * the engine-level reading of CLAUDE.md §2.5. "Invalid page order" tells a user
 * staring at a 90-page document nothing at all.
 */

import type { PageRotation, PdfOrganizeOptions } from './pdf-options'

/**
 * The only angles `/Rotate` may hold. PDF 32000-1 §7.7.3.3 requires a multiple
 * of 90 and pdf-lib enforces it on write, so this is the boundary of what can be
 * produced rather than a house preference.
 */
export const QUARTER_TURNS: ReadonlySet<number> = new Set([0, 90, 180, 270])

export interface OrganizePlan {
  /** The source pages to keep, 1-based, in output order. Never empty. */
  order: readonly number[]
  /** Quarter turns to add, keyed by 1-based *source* page. */
  rotations: ReadonlyMap<number, PageRotation>
}

export function planOrganize(options: PdfOrganizeOptions, pageCount: number): OrganizePlan {
  return {
    order: resolveOrder(options.order, pageCount),
    rotations: resolveRotations(options.rotate, pageCount),
  }
}

/**
 * The pages to keep — every page unchanged when the caller said nothing, which
 * is what a rotate-only job sends.
 */
function resolveOrder(order: readonly number[] | undefined, pageCount: number): number[] {
  if (order === undefined) return Array.from({ length: pageCount }, (_, index) => index + 1)

  if (order.length === 0) {
    throw new Error(
      'The page order keeps no pages, and a PDF with no pages is not a file anyone ' +
        'can open. Keep at least one page.',
    )
  }

  const seen = new Set<number>()

  for (const value of order) {
    const page = toPage(value, pageCount, 'The page order')

    if (seen.has(page)) {
      // Not read as "duplicate this page". `rotate` is keyed by source page, so a
      // page appearing twice in the output has one rotation entry and two places
      // to apply it: the request is ambiguous rather than merely unusual.
      // Duplication becomes possible once rotations are re-keyed by output
      // position, and that is a deliberate change rather than a side effect.
      throw new Error(
        `The page order lists page ${page} twice. Each page can be kept once; ` +
          'remove the repeat.',
      )
    }

    seen.add(page)
  }

  return [...order]
}

/**
 * The rotation map, validated and keyed by 1-based source page.
 *
 * A rotation aimed at a page `order` drops is kept here and simply never looked
 * up. A thumbnail grid holds rotation state per page, so deleting a page the
 * user had already turned leaves a stale entry behind through no fault of
 * theirs, and failing the whole job over a setting with nothing left to apply to
 * would be a rejection with no fix.
 */
function resolveRotations(
  rotate: Readonly<Record<number, PageRotation>> | undefined,
  pageCount: number,
): Map<number, PageRotation> {
  const rotations = new Map<number, PageRotation>()
  if (rotate === undefined) return rotations

  for (const [key, turn] of Object.entries(rotate)) {
    // Record keys are strings once the options have been structured-cloned to
    // the worker, so the page number is parsed rather than assumed.
    const page = toPage(key, pageCount, 'The rotation map')

    if (!QUARTER_TURNS.has(turn)) {
      throw new Error(
        `${turn}° is not a rotation a PDF page can carry. Pages turn in quarter ` +
          'turns: 0, 90, 180 or 270.',
      )
    }

    rotations.set(page, turn)
  }

  return rotations
}

/**
 * The page number `value` names, or an error quoting it.
 *
 * `subject` names the setting the number came from, so "page 9 of 3" points at
 * the page order or at the rotation map rather than at the document in general.
 */
function toPage(value: number | string, pageCount: number, subject: string): number {
  const page = Number(value)

  if (!Number.isSafeInteger(page)) {
    throw new Error(`${subject} names "${value}", which is not a whole page number.`)
  }

  if (page < 1) {
    throw new Error(`Page numbers start at 1, but ${lowerFirst(subject)} names "${value}".`)
  }

  if (page > pageCount) {
    throw new Error(
      `${subject} names page ${page}, but the document has ${pageCount} ` +
        `page${pageCount === 1 ? '' : 's'}.`,
    )
  }

  return page
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1)
}
