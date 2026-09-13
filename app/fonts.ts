import localFont from 'next/font/local'

/**
 * The three families of the Docify type system, self-hosted, and each one cut
 * in two.
 *
 * `next/font/local` is used rather than `next/font/google`. Both end up serving
 * the woff2 from this origin, so both satisfy the acceptance criterion, but
 * `next/font/google` reaches fonts.googleapis.com **at build time** — the build
 * then depends on a third-party host staying up and on the exact bytes it
 * decides to return that day. The originals in `assets/fonts/` are the same
 * latin subsets Google serves, pinned in the repository, so a build is
 * reproducible and works with no network at all. Licence:
 * `public/fonts/OFL.txt`.
 *
 * ## Why each family is two files (issue #315)
 *
 * Google's `latin` subset is 230 codepoints. The 260 documents this site
 * prerenders use 82 of them, and every one above U+007E is a quote, a dash or
 * ©. The other 148 — Latin-1's accented letters, the currency and maths signs,
 * the rest of General Punctuation — were being *preloaded* on every page view,
 * 105kB of critical-path bytes carried on the chance that a file name contains
 * an ï.
 *
 * They are still all here, and any character still renders in its own typeface.
 * What changed is when the bytes arrive. Each family declares two faces:
 *
 * - **core** — `CORE_UNICODE_RANGE` below, preloaded. 47kB for all three.
 * - **extended** — the rest, *no* `unicode-range`, `preload: false`. The
 *   browser matches a face by unicode-range before it matches by availability,
 *   so an ASCII page never selects this face and never fetches it; a page with
 *   an ï falls through to it and fetches it then.
 *
 * That took the bytes the browser must have before the first paint on `/` from
 * 235kB to 178kB, and the Lighthouse LCP the CI gate measures from 2444ms to
 * the number in the pull request for #315. `scripts/subset-fonts/` cuts the
 * files and explains itself; `pnpm subset:fonts` regenerates them.
 *
 * ## What the ordering in app/globals.css owes this file
 *
 * The core faces carry **no** fallback stack and no metric-adjusted fallback of
 * their own. Next appends both to whichever face declares them, and a
 * `local("Arial")` face has no `unicode-range` — sitting between the core and
 * extended families it would answer for every accented character and the
 * extended file would never load at all. So the whole tail of the stack hangs
 * off the extended face, which is last, and `app/globals.css` composes
 * `--font-display` / `--font-sans` / `--font-mono` as core, then extended.
 *
 * Only the `latin` subset is shipped, upright only, and JetBrains Mono at a
 * single weight. Italics and mono bold are therefore synthesised by the browser
 * — deliberate, since the type scale in CLAUDE.md section 3 asks for neither.
 * Note also that U+2192 is *outside* the latin range: the primary-button arrow
 * is therefore an inline SVG (`components/ui/button.tsx`), and
 * `scripts/design-lint` refuses the whole U+2190–U+21FF block so it cannot
 * quietly become a text character again.
 *
 * Each face exposes a CSS variable. `app/globals.css` maps those onto the
 * `--font-display` / `--font-sans` / `--font-mono` theme tokens. Nothing
 * outside `app/globals.css` should reference the variables directly.
 *
 * The option objects have to be inline literals — the Next font loader reads
 * them at compile time and rejects anything it cannot statically evaluate.
 * That is why the range below is written out here rather than imported from
 * `scripts/subset-fonts/ranges.mjs`, which computes the identical string;
 * `test/app/fonts.test.ts` asserts the two have not drifted apart.
 */

/** Display face, core: headings, stat figures. Variable, so 700 and 800 cost one file. */
export const archivo = localFont({
  src: [
    {
      path: '../public/fonts/archivo-latin-core.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-archivo',
  display: 'swap',
  preload: true,
  // The tail of the stack belongs to the extended face — see the header.
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+20-7E, U+A0, U+A9, U+AB, U+BB, U+D7, U+2013-2014, U+2018-2019, U+201C-201D, U+2026',
    },
  ],
})

/** Display face, everything else in the latin subset. Not preloaded. */
export const archivoExtended = localFont({
  src: [
    {
      path: '../public/fonts/archivo-latin-ext.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-archivo-ext',
  display: 'swap',
  preload: false,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
})

/** Body face, core: paragraphs, card titles, eyebrows. */
export const inter = localFont({
  src: [
    {
      path: '../public/fonts/inter-latin-core.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+20-7E, U+A0, U+A9, U+AB, U+BB, U+D7, U+2013-2014, U+2018-2019, U+201C-201D, U+2026',
    },
  ],
})

/** Body face, everything else in the latin subset. Not preloaded. */
export const interExtended = localFont({
  src: [
    {
      path: '../public/fonts/inter-latin-ext.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter-ext',
  display: 'swap',
  preload: false,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
})

/**
 * Technical face, core: file sizes, formats, byte counts. One weight is enough.
 *
 * `adjustFontFallback` is off on both halves of this family, and for a reason
 * the other two do not have. Left at its default it synthesises a
 * `local("Arial")` face with this font's metrics and inserts it ahead of the
 * `fallback` list — which resolves on virtually every machine and so makes the
 * real monospace stack below unreachable. Byte counts would then render
 * proportionally during the swap window, and permanently if the woff2 failed.
 * Arial is a fair metric proxy for Archivo and Inter; for a mono face it is not.
 */
export const jetbrainsMono = localFont({
  src: [
    {
      path: '../public/fonts/jetbrains-mono-latin-core.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  declarations: [
    {
      prop: 'unicode-range',
      value: 'U+20-7E, U+A0, U+A9, U+AB, U+BB, U+D7, U+2013-2014, U+2018-2019, U+201C-201D, U+2026',
    },
  ],
})

/** Technical face, everything else in the latin subset. Not preloaded. */
export const jetbrainsMonoExtended = localFont({
  src: [
    {
      path: '../public/fonts/jetbrains-mono-latin-ext.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-jetbrains-mono-ext',
  display: 'swap',
  preload: false,
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})

/** Applied to `<html>` in app/layout.tsx so every subtree inherits the variables. */
export const fontVariables = [
  archivo.variable,
  archivoExtended.variable,
  inter.variable,
  interExtended.variable,
  jetbrainsMono.variable,
  jetbrainsMonoExtended.variable,
].join(' ')
