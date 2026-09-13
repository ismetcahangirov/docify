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
 * - **core** — the range these pages set, preloaded. 47kB for all three.
 * - **extended** — the rest of what the source file maps, `preload: false`.
 *
 * A face is matched by `unicode-range` before it is matched by availability, so
 * an ASCII page selects the core face and never so much as looks at the second
 * one; a page with an ï falls through to it and fetches it then. Both ranges
 * are written out below because a `@font-face` needs a literal, and both are
 * checked against the shipped woff2 files by `test/subset-fonts.test.ts` — the
 * risk of writing a coverage down is writing it down wrong, and a codepoint
 * that fell out of both halves would render in Arial with nothing to say so.
 *
 * The extended face is given a range rather than left unscoped for the same
 * reason. An unscoped face claims every codepoint there is: it would be a
 * candidate for ASCII while the core file is still in flight, and for a
 * Japanese file name it has no glyph for — two ways to spend 22kB on something
 * that can never be drawn.
 *
 * Measured on the CI runner the gate runs on, three runs per URL, median, on
 * 2026-09-13 — `main` and this change audited within a minute of each other:
 *
 *                          bytes before first paint        LCP
 *   /                        239kB → 182kB          2343ms → 2129ms
 *   /convert                 234kB → 178kB          2316ms → 2039ms
 *   /convert/heic-to-jpg     230kB → 174kB          2301ms → 2033ms
 *
 * The Lighthouse LCP is a Lantern simulation, and what it simulates is the last
 * of those bytes arriving — which is why 57kB of fonts nobody reads is worth
 * 214ms on a page whose largest element is a heading in the HTML.
 *
 * `scripts/subset-fonts/` cuts the files and explains itself; `pnpm
 * subset:fonts` regenerates them.
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
 * That has a consequence in the subsetter, of all places. Next measures the
 * `size-adjust` of that fallback from the file the face points at, over the
 * lowercase alphabet — and gives up if any of it is missing. The extended half
 * owns no ASCII, so `scripts/subset-fonts/` keeps a–z in it as ballast the
 * range never reaches, and Inter's fallback stays at the 107.89% it measured
 * before this split rather than silently flattening to 100%.
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
 * That is why the two ranges below are written out here rather than imported
 * from `scripts/subset-fonts/ranges.mjs`, which computes the identical strings;
 * `test/app/fonts.test.ts` asserts they have not drifted apart.
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
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0, U+D, U+A1-A8, U+AA, U+AC-BA, U+BC-D6, U+D8-FF, U+102, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308-309, U+323, U+2002, U+2009, U+200B, U+201A, U+201E, U+2022, U+2032-2033, U+2039-203A, U+2044, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF',
    },
  ],
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
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0, U+D, U+A1-A8, U+AA, U+AC-BA, U+BC-D6, U+D8-FF, U+102, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308-309, U+323, U+2002, U+2009, U+200B, U+201A, U+201E, U+2022, U+2032-2033, U+2039-203A, U+2044, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF',
    },
  ],
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
  declarations: [
    {
      prop: 'unicode-range',
      value:
        'U+0, U+D, U+A1-A8, U+AA, U+AC-BA, U+BC-D6, U+D8-FF, U+102, U+131, U+152-153, U+2BB-2BC, U+2C6, U+2DA, U+2DC, U+300-301, U+303-304, U+308-309, U+323, U+2002, U+2009, U+200B, U+201A, U+201E, U+2022, U+2032-2033, U+2039-203A, U+2044, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF',
    },
  ],
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
