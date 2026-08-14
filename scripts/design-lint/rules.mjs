/**
 * The pure half of the design-prohibition gate — see cli.mjs for the runner.
 *
 * CLAUDE.md section 3 lists five prohibitions. Four of them are mechanical, and
 * those are the four encoded here: no glassmorphism, no blue or purple hue, no
 * decorative gradient, and no raw hex code outside the `@theme` palette. Every
 * function below takes the source as a string and does no I/O, so a rule can be
 * tested without a fixture file on disk — which matters, because a fixture that
 * violated the prohibitions would have to be excluded from the scan, and an
 * exclusion is the hole the gate exists to close.
 *
 * @typedef {'css' | 'js'} Language
 * @typedef {{ rule: string, line: number, column: number, text: string, message: string }} Violation
 */

/** Extensions the gate reads. `.css` is parsed as CSS, the rest as JS/TS. */
export const SCANNED_EXTENSIONS = ['.css', '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs']

/**
 * The one file whose `@theme` block may contain hex codes. Named rather than
 * matched by pattern: a second `@theme` block anywhere else would be a second
 * source of truth for the palette.
 */
export const THEME_FILE = 'app/globals.css'

/** Hex colour literal — 3, 4, 6 or 8 digits, the lengths CSS actually accepts. */
const HEX = '#(?:[0-9a-fA-F]{8}|[0-9a-fA-F]{6}|[0-9a-fA-F]{4}|[0-9a-fA-F]{3})\\b'

/** Tailwind colour families that are blue or purple, whatever they are called. */
const BANNED_FAMILIES = 'blue|indigo|violet|purple|fuchsia|sky|cyan'

/** Utility prefixes that take a colour, so `to-purple-600` is caught alongside `bg-blue-500`. */
const COLOUR_PREFIXES =
  'bg|text|border|from|via|to|ring|fill|stroke|outline|decoration|accent|caret|divide|placeholder|shadow'

/** CSS named colours in the blue and purple range, plus their aliases. */
const BANNED_KEYWORDS = [
  'aqua',
  'blue',
  'blueviolet',
  'cadetblue',
  'cornflowerblue',
  'cyan',
  'darkblue',
  'darkcyan',
  'darkorchid',
  'darkslateblue',
  'darkviolet',
  'deepskyblue',
  'dodgerblue',
  'fuchsia',
  'indigo',
  'lightblue',
  'lightskyblue',
  'magenta',
  'mediumblue',
  'mediumpurple',
  'mediumslateblue',
  'midnightblue',
  'navy',
  'orchid',
  'powderblue',
  'purple',
  'rebeccapurple',
  'royalblue',
  'skyblue',
  'slateblue',
  'steelblue',
  'teal',
  'violet',
].join('|')

const GLASSMORPHISM =
  'blur|brightness|contrast|filter|grayscale|hue-rotate|invert|opacity|saturate|sepia'

/**
 * @typedef {{
 *   id: string,
 *   languages: Language[],
 *   pattern: RegExp,
 *   message: string,
 *   allowedInTheme?: boolean,
 * }} Rule
 *
 * @type {Rule[]}
 */
const RULES = [
  {
    id: 'no-glassmorphism',
    languages: ['css', 'js'],
    pattern: new RegExp(`\\bbackdrop-(?:${GLASSMORPHISM})\\b`, 'g'),
    message: 'glassmorphism is forbidden — surfaces are a flat fill plus a 1px border',
  },
  {
    id: 'no-banned-hue',
    languages: ['css', 'js'],
    pattern: new RegExp(`\\b(?:${COLOUR_PREFIXES})-(?:${BANNED_FAMILIES})(?:-\\d{2,3})?\\b`, 'g'),
    message: 'blue and purple hues are forbidden — use a --color-* token from the @theme palette',
  },
  {
    id: 'no-banned-hue',
    languages: ['css'],
    pattern: new RegExp(`\\b(?:${BANNED_KEYWORDS})\\b`, 'g'),
    message: 'blue and purple hues are forbidden — use a --color-* token from the @theme palette',
  },
  {
    id: 'no-gradient',
    languages: ['css', 'js'],
    // `bg-gradient-to-r` is Tailwind v3, `bg-linear-to-r` and `bg-radial` v4.
    pattern: /\bbg-(?:gradient|linear|radial|conic)(?:-[a-z0-9-]+)?\b/g,
    message: 'decorative gradients are forbidden — fill the surface with a single token',
  },
  {
    id: 'no-gradient',
    languages: ['css', 'js'],
    pattern: /\b(?:repeating-)?(?:linear|radial|conic)-gradient\s*\(/g,
    message: 'decorative gradients are forbidden — fill the surface with a single token',
  },
  {
    id: 'no-raw-hex',
    languages: ['css'],
    pattern: new RegExp(HEX, 'g'),
    message: `raw hex codes are forbidden — declare the colour in the @theme block of ${THEME_FILE}`,
    allowedInTheme: true,
  },
  {
    /*
     * In TS and JSX a hex is only recognised where it unambiguously is one: a
     * Tailwind arbitrary value, or a string that is nothing but the colour.
     * Matching a bare `#124` anywhere would flag every issue reference in the
     * codebase, and app/fonts.ts carries one.
     */
    id: 'no-raw-hex',
    languages: ['js'],
    pattern: new RegExp(`\\[[^\\]\\n]*${HEX}[^\\]\\n]*\\]|(['"\`])${HEX}\\1`, 'g'),
    message: `raw hex codes are forbidden — declare the colour in the @theme block of ${THEME_FILE}`,
  },
]

/**
 * The language a path is read as.
 *
 * @param {string} filePath repository-relative, POSIX separators
 * @returns {Language}
 */
export function languageOf(filePath) {
  return filePath.endsWith('.css') ? 'css' : 'js'
}

/**
 * The source with every comment blanked out, character for character.
 *
 * Comments are excluded from the scan because the design system is documented
 * in the code it constrains: components/ui/dialog.tsx names the very
 * `backdrop-blur` it strips. Replacing each comment character with a space
 * rather than removing it keeps every later match on its original line.
 *
 * @param {string} source
 * @param {Language} language
 * @returns {string}
 */
function maskComments(source, language) {
  /** @param {string} match */
  const blank = (match) => match.replace(/[^\n]/g, ' ')

  const masked = source.replace(/\/\*[\s\S]*?\*\//g, blank)
  if (language === 'css') return masked

  // The `[^:]` guard keeps `https://` inside a string from starting a comment.
  return masked.replace(/(^|[^:\\])\/\/[^\n]*/g, (match, before) => before + blank(match).slice(1))
}

/**
 * The character range of the `@theme { ... }` block, or null when there is none.
 *
 * @param {string} source
 * @returns {{ start: number, end: number } | null}
 */
function themeRange(source) {
  const opening = source.indexOf('@theme')
  if (opening === -1) return null

  const start = source.indexOf('{', opening)
  if (start === -1) return null

  let depth = 0
  for (let index = start; index < source.length; index += 1) {
    if (source[index] === '{') depth += 1
    if (source[index] === '}') {
      depth -= 1
      if (depth === 0) return { start, end: index }
    }
  }

  return null
}

/**
 * Every prohibited construct in one file, in source order.
 *
 * @param {string} filePath repository-relative, POSIX separators
 * @param {string} source
 * @returns {Violation[]}
 */
export function findViolations(filePath, source) {
  const language = languageOf(filePath)
  const masked = maskComments(source, language)
  const theme = filePath === THEME_FILE ? themeRange(masked) : null

  const lineStarts = [0]
  for (let index = 0; index < masked.length; index += 1) {
    if (masked[index] === '\n') lineStarts.push(index + 1)
  }

  /** @type {Violation[]} */
  const violations = []

  for (const rule of RULES) {
    if (!rule.languages.includes(language)) continue

    for (const match of masked.matchAll(rule.pattern)) {
      const index = match.index ?? 0
      if (rule.allowedInTheme && theme && index > theme.start && index < theme.end) continue

      let line = lineStarts.length
      while (lineStarts[line - 1] > index) line -= 1

      violations.push({
        rule: rule.id,
        line,
        column: index - lineStarts[line - 1] + 1,
        text: match[0],
        message: rule.message,
      })
    }
  }

  return violations.sort((a, b) => a.line - b.line || a.column - b.column)
}
