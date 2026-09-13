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
 * Every OpenType feature a shaper applies on its own — harfbuzz's
 * `common_features` plus its `horizontal_features`.
 *
 * `keepFeatures` is an **allowlist**: pass it and harfbuzz clears its default
 * set first, so anything left out is gone whether or not the browser would have
 * applied it. This list is therefore the default set written out rather than a
 * selection from it — `rvrn` most of all, which is Required Variation
 * Alternates and is applied unconditionally to a variable font like Archivo.
 *
 * What is *not* here, and is the point of passing a list at all, is every
 * opt-in feature: `frac`, `numr`, `dnom`, `pnum`, `tnum`, the stylistic sets
 * and character variants. A browser applies none of those unless a stylesheet
 * asks with `font-variant-*` or `font-feature-settings`, and nothing in this
 * design system does. Their lookups drag glyphs into the subset all the same.
 */
const DEFAULT_FEATURES = /** @type {readonly string[]} */ ([
  'abvm',
  'blwm',
  'ccmp',
  'locl',
  'mark',
  'mkmk',
  'rlig',
  'calt',
  'clig',
  'curs',
  'dist',
  'kern',
  'liga',
  'rclt',
  'rvrn',
])

/**
 * The same, minus `calt` — for JetBrains Mono, whose entire `calt` table is the
 * programming-ligature set that turns `->`, `!=`, `::` and `www` into single
 * glyphs.
 *
 * Docify never renders code. The mono face carries step numbers, byte counts,
 * format names and the occasional file name, and in a file name `--` becoming
 * one long dash is a bug rather than a feature. Dropping `calt` (138 lookups,
 * and the ~250 glyphs they reach) takes the preloaded half of this family from
 * 15.9kB to 5.2kB, which is the single largest saving in the split.
 *
 * `liga` stays in the list and costs nothing: JetBrains Mono has no `liga` at
 * all. Its GSUB declares exactly `calt`, `ccmp`, `frac` and `mark`.
 */
const NO_LIGATURE_FEATURES = /** @type {readonly string[]} */ (
  DEFAULT_FEATURES.filter((feature) => feature !== 'calt')
)

/** @type {readonly Family[]} */
export const FAMILIES = [
  {
    source: 'archivo-latin-variable.woff2',
    core: 'archivo-latin-core.woff2',
    extended: 'archivo-latin-ext.woff2',
    features: DEFAULT_FEATURES,
  },
  {
    source: 'inter-latin-variable.woff2',
    core: 'inter-latin-core.woff2',
    extended: 'inter-latin-ext.woff2',
    features: DEFAULT_FEATURES,
  },
  {
    source: 'jetbrains-mono-latin-400.woff2',
    core: 'jetbrains-mono-latin-core.woff2',
    extended: 'jetbrains-mono-latin-ext.woff2',
    features: NO_LIGATURE_FEATURES,
  },
]

/** Where the vendored originals live — outside `public/`, so they are not served. */
export const SOURCE_DIR = 'assets/fonts'

/** Where the two halves are written, and where `app/fonts.ts` reads them from. */
export const OUTPUT_DIR = 'public/fonts'
