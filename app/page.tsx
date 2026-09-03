/*
 * The scaffold's placeholder home page, still waiting for the marketing
 * sections in EPIC 2.
 *
 * Its colours are `@theme` tokens rather than Tailwind's own palette. That is
 * the house rule (CLAUDE.md §3) and it is also what makes the page auditable:
 * Tailwind v4 emits its built-in palette as `oklch()`, and axe-core cannot
 * compute a contrast ratio from a colour it cannot parse — it reported all
 * three paragraphs here as *unknown* rather than as passing or failing, which
 * is the one answer `e2e/a11y.spec.ts` cannot accept.
 */
export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center px-6 py-24">
      {/*
       * The content sits on a `paper` surface rather than directly on the
       * shell, which is the design system's own pattern (flat fill, one
       * hairline) and is also what makes the muted text legal: `fg-light-mut`
       * on `shell` measures 4.41:1, just under the 4.5:1 AA needs, while the
       * same colour on `paper` measures 4.78:1. Muted text belongs on a
       * surface; the shell is the ground between them.
       */}
      <div className="flex flex-col gap-6 border border-line-light bg-paper p-8">
        <p className="text-eyebrow uppercase text-fg-light-mut">Docify</p>

        <h1 className="text-4xl uppercase leading-[0.95] tracking-[-0.02em] sm:text-6xl">
          Convert any file, entirely in your browser
        </h1>

        <p className="max-w-prose text-balance text-fg-light-mut">
          Scaffold placeholder. The design tokens, typography and marketing sections arrive with the
          design system; the conversion router and engines follow after that.
        </p>

        <div className="border border-line-light bg-paper-2 p-4">
          <p className="text-sm text-fg-light-mut">
            Nothing here talks to a server. Every conversion Docify ships will run on your own
            device.
          </p>
        </div>
      </div>
    </main>
  )
}
