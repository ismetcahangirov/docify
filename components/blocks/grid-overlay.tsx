import { cn } from '@/lib/utils'

/*
 * The grid overlay — the sixth signature pattern (docify-design §6), and the
 * one that belongs to the home page hero alone. Do not use it anywhere else.
 *
 * ## Why an SVG and not a background
 *
 * The usual way to draw a 1px grid is two `repeating-linear-gradient`s, and the
 * design gate (`scripts/design-lint/`) rejects every gradient function without
 * asking what it draws. So the lines are a `<pattern>` on an inline SVG: two
 * strokes in `currentColor`, tiled. The colour comes from a token class on the
 * element and the opacity from a utility, exactly as the pattern is specified.
 *
 * ## Where it may sit
 *
 * Never under text. axe cannot compute a contrast ratio for text that has an
 * image node anywhere in the stack beneath it — it reports the check as
 * *incomplete*, which `e2e/a11y.spec.ts` treats as the failure it is — and an
 * inline SVG is an image node. So the caller places it, with the geometry
 * classes, in a part of the block that holds no text: a band inside the
 * padding, beside the content on a wide screen, never `inset-0`.
 *
 * It is decoration, so it is hidden from assistive technology, and it is
 * `pointer-events-none` so nothing it happens to sit beside loses the cursor.
 * The parent must be `relative` and clip its overflow.
 */
export function GridOverlay({ className }: { className?: string }) {
  return (
    <svg
      data-slot="grid-overlay"
      aria-hidden="true"
      focusable="false"
      className={cn('pointer-events-none absolute text-line-light opacity-50', className)}
    >
      <defs>
        <pattern id="grid-overlay-cell" width="48" height="48" patternUnits="userSpaceOnUse">
          <path d="M 48 0 L 0 0 0 48" fill="none" stroke="currentColor" strokeWidth="1" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#grid-overlay-cell)" />
    </svg>
  )
}
