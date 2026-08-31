import localFont from 'next/font/local'

/**
 * The three families of the Docify type system, self-hosted.
 *
 * `next/font/local` is used rather than `next/font/google`. Both end up serving
 * the woff2 from this origin, so both satisfy the acceptance criterion, but
 * `next/font/google` reaches fonts.googleapis.com **at build time** — the build
 * then depends on a third-party host staying up and on the exact bytes it
 * decides to return that day. The files here are the same latin subsets Google
 * serves, pinned in the repository, so a build is reproducible and works with
 * no network at all. Licence: `public/fonts/OFL.txt`.
 *
 * Only the `latin` subset is shipped (the same unicode-range Google serves for
 * it), upright only, and JetBrains Mono at a single weight. Italics and mono
 * bold are therefore synthesised by the browser — deliberate, since the type
 * scale in CLAUDE.md section 3 asks for neither. Note also that U+2192 is
 * *outside* the latin range: the primary-button arrow is therefore an inline
 * SVG (`components/ui/button.tsx`), and `scripts/design-lint` refuses the whole
 * U+2190–U+21FF block so it cannot quietly become a text character again.
 *
 * Each family exposes a CSS variable. `app/globals.css` maps those onto the
 * `--font-display` / `--font-sans` / `--font-mono` theme tokens — that mapping
 * lands with the design tokens in issue #13, so until it does nothing on the
 * page actually uses these faces. Nothing outside `app/globals.css` should
 * reference the variables directly.
 *
 * The option objects have to be inline literals — the Next font loader reads
 * them at compile time and rejects anything it cannot statically evaluate.
 */

/** Display face: headings, stat figures. Variable, so 700 and 800 cost one file. */
export const archivo = localFont({
  src: [
    {
      path: '../public/fonts/archivo-latin-variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-archivo',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
})

/** Body face: paragraphs, card titles, eyebrows. */
export const inter = localFont({
  src: [
    {
      path: '../public/fonts/inter-latin-variable.woff2',
      weight: '100 900',
      style: 'normal',
    },
  ],
  variable: '--font-inter',
  display: 'swap',
  preload: true,
  fallback: ['ui-sans-serif', 'system-ui', 'sans-serif'],
})

/**
 * Technical face: file sizes, formats, byte counts. One weight is enough.
 *
 * `adjustFontFallback` is off here. Left at its default it synthesises a
 * `local("Arial")` face with this font's metrics and inserts it ahead of the
 * `fallback` list — which resolves on virtually every machine and so makes the
 * real monospace stack below unreachable. Byte counts would then render
 * proportionally during the swap window, and permanently if the woff2 failed.
 * Arial is a fair metric proxy for Archivo and Inter; for a mono face it is not.
 */
export const jetbrainsMono = localFont({
  src: [
    {
      path: '../public/fonts/jetbrains-mono-latin-400.woff2',
      weight: '400',
      style: 'normal',
    },
  ],
  variable: '--font-jetbrains-mono',
  display: 'swap',
  preload: true,
  adjustFontFallback: false,
  fallback: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'monospace'],
})

/** Applied to `<html>` in app/layout.tsx so every subtree inherits the variables. */
export const fontVariables = `${archivo.variable} ${inter.variable} ${jetbrainsMono.variable}`
