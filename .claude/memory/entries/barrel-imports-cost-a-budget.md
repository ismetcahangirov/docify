---
name: "barrel-imports-cost-a-budget"
description: "A single umbrella import cost 76 kB gzipped on every route — pnpm size names the route, never the package"
type: "gotcha"
date: "2026-09-02"
---

`components/blocks/section-block.tsx` imports one thing — `Slot` — from the
`radix-ui` umbrella package. Webpack could not see through that barrel, so every
route rendering a `SectionBlock` shipped **every Radix primitive**: 76 kB
gzipped, on a 120 kB first-load budget.

It stayed invisible for six issues because nothing rendered a `SectionBlock`.
The homepage was a scaffold placeholder and the converter components had no
page, so no route pulled it in. The first real page (`/convert/[pair]`, issue
#66) put `/convert` at 179.7 kB and `/convert/[pair]` at 213 kB — both over
budget, and neither for the reason it looked like.

The fix is in `next.config.ts`:

```ts
experimental: { optimizePackageImports: ['radix-ui', 'lucide-react'] }
```

Next rewrites the barrel import into a direct one at build time. `/convert` went
back to 103.2 kB — the shared baseline — on that change alone. `lucide-react` is
already on Next's own default list; it is named explicitly so the intent does
not depend on that list staying as it is.

## Why this is worth remembering

`pnpm size` reports a route, not a package. The failure says "/convert is 59.7 kB
over" and points at the page that happened to be added, which is almost never
where the weight came from. The diagnosis is to gzip the individual chunks in
`.next/static/chunks/` and grep them for identifiable strings:

```bash
node -e "const m=require('./.next/app-build-manifest.json'); …"   # chunks per route
grep -c 'radix' .next/static/chunks/<the big one>.js
```

## Revisit triggers

- Any new dependency that ships a single barrel entry point — `radix-ui` is the
  pattern, not the only instance. Add it to `optimizePackageImports` at the same
  time as the dependency, not after `pnpm size` fails.
- The homepage stops being a placeholder. It will render `SectionBlock` and would
  have inherited the same 76 kB.

Related: [[coep-require-corp-scoped]]
