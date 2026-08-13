import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

/*
 * The design tokens, read out of app/globals.css at test time.
 *
 * Deriving them beats transcribing them. A hand-copied list keeps passing after
 * a token is renamed in globals.css — the components then compile to no CSS at
 * all and every assertion still agrees with its own stale copy. Reading the
 * real file means a rename fails the suite instead.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

export const globalsCss = readFileSync(join(repoRoot, 'app', 'globals.css'), 'utf8')

const declarations = globalsCss.replace(/\/\*[\s\S]*?\*\//g, '')

/** The body of the single top-level `@theme { ... }` block, comments removed. */
const themeBlock = (() => {
  const opening = declarations.indexOf('@theme')
  if (opening === -1) throw new Error('app/globals.css declares no @theme block')

  const start = declarations.indexOf('{', opening)
  let depth = 0

  for (let i = start; i < declarations.length; i += 1) {
    if (declarations[i] === '{') depth += 1
    if (declarations[i] === '}') {
      depth -= 1
      if (depth === 0) return declarations.slice(start + 1, i)
    }
  }

  throw new Error('app/globals.css has an unbalanced @theme block')
})()

const tokens = new Map<string, string>(
  themeBlock
    .split(';')
    .map((declaration) => declaration.match(/^\s*(--[\w-]+)\s*:\s*([\s\S]+)$/))
    .filter((match): match is RegExpMatchArray => match !== null)
    .map((match) => [match[1], match[2].trim().replace(/\s+/g, ' ')]),
)

/** Colour name (`paper-2`) to its hex value, for every `--color-*` token. */
export const COLOURS = new Map(
  [...tokens]
    .filter(([name]) => name.startsWith('--color-'))
    .map(([name, value]) => [name.slice('--color-'.length), value.toLowerCase()]),
)

/** The base steps of the type scale: `body`, `h3`, ... — never the sub-keys. */
export const TYPE_SCALE = [...tokens.keys()]
  .filter((name) => name.startsWith('--text-') && !name.slice('--text-'.length).includes('--'))
  .map((name) => name.slice('--text-'.length))

/** The radius steps: `sm`, `md`, `lg`, `xl`. */
export const RADII = [...tokens.keys()]
  .filter((name) => name.startsWith('--radius-'))
  .map((name) => name.slice('--radius-'.length))

function channel(value: number): number {
  const srgb = value / 255
  return srgb <= 0.04045 ? srgb / 12.92 : ((srgb + 0.055) / 1.055) ** 2.4
}

function luminance(hex: string): number {
  const value = hex.replace('#', '')
  const full =
    value.length === 3
      ? value
          .split('')
          .map((c) => c + c)
          .join('')
      : value

  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(full.slice(i, i + 2), 16)))
  return 0.2126 * r + 0.7152 * g + 0.0722 * b
}

/** The WCAG 2.x contrast ratio between two palette colours, by token name. */
export function contrastRatio(a: string, b: string): number {
  const hexA = COLOURS.get(a)
  const hexB = COLOURS.get(b)

  if (hexA === undefined) throw new Error(`unknown colour token: ${a}`)
  if (hexB === undefined) throw new Error(`unknown colour token: ${b}`)

  const [light, dark] = [luminance(hexA), luminance(hexB)].sort((x, y) => y - x)
  return (light + 0.05) / (dark + 0.05)
}
