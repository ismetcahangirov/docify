---
name: docify-seo-page
description: Use when adding or editing a conversion tool page, metadata, JSON-LD, sitemap, or the pairs registry. Docify's growth depends entirely on programmatic SEO across 120+ pages — this defines the content uniqueness bar, metadata rules, schema requirements, and internal linking matrix.
---

# Docify Programmatic SEO

The project's growth depends entirely on this. However good the code is, a project with no traffic is dead.

## Source of truth

`lib/registry/pairs.ts` is the **single source of truth**. Pages, sitemap, internal links and OG images are all generated from it.

```ts
export interface ConversionPair {
  from: FormatId
  to: FormatId
  slug: string                  // 'heic-to-jpg'
  op: Operation
  /** UNIQUE — not a template fill-in */
  h1: string
  intro: string                 // 40–70 words
  steps: [string, string, string]
  faq: Array<{ q: string; a: string }>   // at least 4
  /** A technical note specific to this pair — e.g. that HEIC is an Apple format */
  note: string
  related: string[]             // 6+ slugs
  monthlySearches?: number      // used for prioritisation
}
```

## The uniqueness bar — the most important rule

Google penalises templated duplicates. On every page:

- **H1 must genuinely differ** — not a template with the format names swapped
- **Intro is 40–70 words, specific to this pair** — why people actually perform this conversion
- **At least 4 FAQs, all pair-specific** — "Will I lose quality?" is a generic question, but the answer must be format-specific
- **The `note` field is mandatory** — e.g. *"HEIC has been the default format on iPhones since 2017. Windows cannot open it natively, which makes converting to JPG the simplest fix."*
- **Template overlap < 40%** — measured in CI by `scripts/check-content-uniqueness.ts`

Spend real time writing the copy when adding a pair. Twenty unique pages beat 120 duplicated ones.

## Metadata rules

```ts
// lib/seo/metadata.ts
title:       `${FROM} to ${TO} Converter — Free, In Your Browser | Docify`   // ≤ 60 chars
description: pair-specific, 140–155 chars, includes "no upload" and "free"
canonical:   `https://docify.app/convert/${slug}`                            // MANDATORY
openGraph:   type: 'website', dynamic OG image
```

No two pages may share a `title` or `description` — this is checked in CI.

## JSON-LD — all three on every tool page

```
1. SoftwareApplication   → applicationCategory: 'UtilitiesApplication'
                           offers: { price: '0', priceCurrency: 'USD' }
2. HowTo                 → generated from the steps array
3. FAQPage               → generated from the faq array
```

Add `BreadcrumbList` as well: `Home → Converters → HEIC to JPG`.

Validate with Google's Rich Results Test after any change.

## Route structure

```
/                          homepage
/convert/[pair]            /convert/heic-to-jpg      ← the bulk of SEO volume
/tools/[slug]              /tools/pdf-merge          ← operation pages
/formats/[format]          /formats/heic             ← format explainer, hub page
```

Use `generateStaticParams` for build-time static generation. Every page must be SSG with no client-side data fetching.

## Internal linking matrix

At least **6 internal links** per page:
- 3 × from the same source format to other targets (`heic-to-png`, `heic-to-webp`, `heic-to-pdf`)
- 2 × from other sources to the same target (`webp-to-jpg`, `png-to-jpg`)
- 1 × the format hub page (`/formats/heic`)

This is a hub-and-spoke architecture — no page may be orphaned.

## Performance is part of SEO

Tool pages must render as **complete static HTML**. The converter UI attaches after hydration, but the heading, explanation, FAQ and steps must be present in the HTML without JavaScript.

```
LCP < 1.8s · CLS < 0.05 · INP < 200ms · Lighthouse SEO = 100
```

No WASM in the initial load — this is both a performance and an SEO gate.

## Checklist for adding a pair

- [ ] Add an entry to `pairs.ts` with unique copy (h1, intro, 3 steps, 4+ FAQs, note)
- [ ] 6+ slugs in the `related` array
- [ ] Confirm the router supports the pair (prove it with a `route()` test)
- [ ] `pnpm build` — the page is statically generated
- [ ] Title/description uniqueness test passes
- [ ] All three JSON-LD blocks render
- [ ] The page appears in the sitemap
- [ ] Lighthouse SEO = 100

## Companion skills

Also use these for this work:
- `claude-seo:seo-programmatic` — templated page strategy
- `claude-seo:seo-schema` — JSON-LD validation
- `claude-seo:seo-technical` — canonical, robots, indexability
- `claude-seo:seo-audit` — full pre-launch audit
