import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

/**
 * The steps of the type scale declared as `--text-*` in app/globals.css.
 *
 * tailwind-merge has to be told about them. `text-` is overloaded — it is both
 * the font-size utility and the text-colour utility — and tailwind-merge
 * resolves the ambiguity from the theme. It only recognises the stock scale
 * (`text-sm`, `text-lg`, ...), so a project step like `text-body` looks like a
 * colour to it and is dropped the moment a real colour follows it in the same
 * `cn()` call. Listing the steps here restores the distinction: a step and a
 * colour coexist, two steps still collapse, two colours still collapse.
 */
export const TYPE_SCALE = ['display', 'h2', 'h3', 'eyebrow', 'body', 'stat', 'tech'] as const

const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: [...TYPE_SCALE],
    },
  },
})

/**
 * Joins class names and lets the later of two conflicting Tailwind utilities
 * win. Every component under `components/ui/` composes its base utilities with
 * the caller's `className` through this helper, so a caller can override a base
 * utility (`<Button className="rounded-none">`) instead of fighting it with
 * specificity.
 */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
