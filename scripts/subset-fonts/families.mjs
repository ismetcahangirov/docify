/**
 * What `scripts/subset-fonts/cli.mjs` cuts, and what it keeps while cutting.
 *
 * One entry per family: the vendored Google latin file it reads, the two files
 * it writes, and the OpenType layout features the subsetter is told to retain.
 */

/**
 * @typedef {object} Family
 * @property {string} source     File in `assets/fonts/` — the vendored original.
 * @property {string} core       File written to `public/fonts/`, preloaded.
 * @property {string} extended   File written to `public/fonts/`, fetched on demand.
 * @property {readonly string[]} features OpenType feature tags to retain.
 */

/**
 * What a face setting prose needs: mark attachment and kerning for the accents
 * in the extended half, and the ligature and contextual-alternate machinery a
 * text face applies to ordinary words.
 */
const PROSE_FEATURES = /** @type {readonly string[]} */ ([
  'ccmp',
  'locl',
  'mark',
  'mkmk',
  'kern',
  'liga',
  'clig',
  'calt',
  'rlig',
])

/**
 * The same, without the substitution features — for JetBrains Mono, whose
 * entire `calt` table is the programming-ligature set that turns `->`, `!=`,
 * `::` and `www` into single glyphs.
 *
 * Docify never renders code. The mono face carries step numbers, byte counts,
 * format names and the occasional file name, and in a file name `--` becoming
 * one long dash is a bug rather than a feature. Dropping `calt` (138 lookups,
 * and the ~250 glyphs they reach) takes the preloaded half of this family from
 * 15.9kB to 5.2kB, which is the single largest saving in the split.
 *
 * `liga` is not in the list because JetBrains Mono has none: its GSUB declares
 * exactly `calt`, `ccmp`, `frac` and `locl`, and `frac` is off by default.
 */
const PLAIN_FEATURES = /** @type {readonly string[]} */ (['ccmp', 'locl', 'mark', 'mkmk', 'kern'])

/** @type {readonly Family[]} */
export const FAMILIES = [
  {
    source: 'archivo-latin-variable.woff2',
    core: 'archivo-latin-core.woff2',
    extended: 'archivo-latin-ext.woff2',
    features: PROSE_FEATURES,
  },
  {
    source: 'inter-latin-variable.woff2',
    core: 'inter-latin-core.woff2',
    extended: 'inter-latin-ext.woff2',
    features: PROSE_FEATURES,
  },
  {
    source: 'jetbrains-mono-latin-400.woff2',
    core: 'jetbrains-mono-latin-core.woff2',
    extended: 'jetbrains-mono-latin-ext.woff2',
    features: PLAIN_FEATURES,
  },
]

/** Where the vendored originals live — outside `public/`, so they are not served. */
export const SOURCE_DIR = 'assets/fonts'

/** Where the two halves are written, and where `app/fonts.ts` reads them from. */
export const OUTPUT_DIR = 'public/fonts'
