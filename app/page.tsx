export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col justify-center gap-6 px-6 py-24">
      <p className="text-xs font-medium uppercase tracking-[0.18em] text-neutral-500">Docify</p>

      <h1 className="text-4xl uppercase leading-[0.95] tracking-[-0.02em] sm:text-6xl">
        Convert any file, entirely in your browser
      </h1>

      <p className="max-w-prose text-balance text-neutral-600">
        Scaffold placeholder. The design tokens, typography and marketing sections arrive with the
        design system; the conversion router and engines follow after that.
      </p>

      <div className="border border-neutral-300 p-4">
        <p className="text-sm text-neutral-600">
          Nothing here talks to a server. Every conversion Docify ships will run on your own device.
        </p>
      </div>
    </main>
  )
}
