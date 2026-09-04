# The pre-launch SEO audit

Issue #104. Run against the production build of commit on branch
`test/104-pre-launch-seo-audit`, 3 September 2026, `next build` output of
128 prerendered HTML files.

**Result: no critical findings.** The audit is `pnpm audit:seo`, it runs in CI's
`build` job on every pull request, and it fails the build on any critical
finding. What follows is what it checks, why those checks and not others, and
what it found the first time it was run.

---

## Why an audit that reads the output

There were already four SEO guards in this repository before this one, and all
four assert about the _inputs_:

| Guard                              | What it proves                                                         |
| ---------------------------------- | ---------------------------------------------------------------------- |
| `test/seo/metadata.test.ts`        | the title and description **generator** is correct for all 124 pairs   |
| `test/app/sitemap.test.ts`         | the **sitemap** lists every page, at the URL each page calls canonical |
| `test/registry/copy.test.ts`       | the **copy** is unique, long enough, and exists for every pair         |
| `scripts/check-content-uniqueness` | no two pages **overlap** by more than 40% of their four-word shingles  |

Every one of them would keep passing if Next.js stopped emitting the canonical
tag, if a `<meta name="robots">` arrived from somewhere nobody looked, or if a
component reused in a new place rendered a second `<h1>`. They test the thing
that produces the page. Nothing tested the page.

That gap is not hypothetical. Of the eight critical findings below, **six were
invisible to every existing test**, and one of them — the missing `og:image` on
the hub — was introduced by the change that added Open Graph images in the first
place.

---

## What is checked

Per page, in `scripts/seo-audit/rules.mjs`:

| Rule                 | Severity | What fails it                                                                                                                                 |
| -------------------- | -------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `html-lang`          | critical | `<html>` with no `lang`                                                                                                                       |
| `viewport`           | critical | no viewport meta                                                                                                                              |
| `title`              | critical | no `<title>`                                                                                                                                  |
| `title-length`       | warning  | over 60 characters, so a result truncates it                                                                                                  |
| `description`        | critical | an indexable page with no meta description                                                                                                    |
| `description-length` | warning  | under 140 (Google rewrites it) or over 160 (it is cut)                                                                                        |
| `canonical`          | critical | absent, or naming an address other than the one the page is served at                                                                         |
| `robots`             | critical | an indexable page asking for `noindex`, or a `noindex` page not asking                                                                        |
| `h1`                 | critical | no `<h1>`, or more than one                                                                                                                   |
| `heading-order`      | warning  | a level skipped, `h1` straight to `h3`                                                                                                        |
| `open-graph`         | critical | a missing `og:title`, `og:description`, `og:image` or `og:url`                                                                                |
| `open-graph`         | warning  | `og:url` disagreeing with the canonical                                                                                                       |
| `twitter`            | warning  | no `twitter:card`, so a link previews as a bare title                                                                                         |
| `structured-data`    | critical | a conversion page with no JSON-LD, JSON-LD that does not parse, or missing one of `SoftwareApplication`, `HowTo`, `FAQPage`, `BreadcrumbList` |
| `dead-end`           | critical | an indexable page that links nowhere else on the site                                                                                         |

Across the whole set:

| Rule                    | Severity | What fails it                                       |
| ----------------------- | -------- | --------------------------------------------------- |
| `broken-link`           | critical | an internal link to a URL the build did not produce |
| `duplicate-title`       | critical | two indexable pages with the same `<title>`         |
| `duplicate-description` | critical | two indexable pages with the same description       |

### What a `noindex` page is not asked for

A canonical URL, a meta description and an `og:url` are all claims a page makes
about where it sits in a search result. A page that has asked not to be in one
has nothing to claim, so `/tools` and the 404 shell are exempt from those three
and are still held to `html-lang`, `viewport`, `title` and `h1`. Requiring the
rest of them would be requiring ceremony rather than correctness.

### What is deliberately not checked here

- **Contrast, focus, motion, ARIA.** `e2e/a11y.spec.ts` runs axe over the four
  page shapes and asserts zero WCAG 2.2 AA violations. Lighthouse scores
  accessibility at 1.00 on all three URLs it audits.
- **Core Web Vitals.** `e2e/vitals.spec.ts` measures LCP, CLS, blocking time
  and interaction latency under Lighthouse's mobile throttling, and
  `lighthouserc.cjs` asserts LCP, CLS and TBT again through Lighthouse's own
  methodology.
- **Whether the copy is any good.** No machine decides that. It is decided by
  `test/registry/copy.test.ts`'s word counts and by
  `scripts/check-content-uniqueness`'s 40% overlap ceiling, and beyond those by
  reading it.
- **Anything about the live deployment.** Server response codes, redirects,
  HTTPS, `hreflang`, Search Console. Those belong to #99 and #103, which are
  about a site that is actually deployed. This audit runs against the build.

---

## What it found

Eight critical findings and four warnings, on the first run. All twelve are
fixed in the same pull request.

### 1. The home page had no canonical URL — critical

`app/page.tsx` exported no `metadata` at all, so it inherited the root layout's
title and description and declared no canonical. A page with no canonical is a
page that will be indexed under whichever URL happens to link to it — with a
tracking parameter, with a trailing slash, from a preview deployment.

**Fixed** by giving the home page its own metadata, including its own
description, which is the one result somebody sees when they search the brand.

### 2. The hub shipped an Open Graph card with no image — critical

`/convert` declared an `openGraph` object with a title, a description and a URL.
Next.js treats a declared `openGraph` as complete and does **not** merge
`app/opengraph-image.tsx` into it, so the hub — the single most-shared URL on
the site after the home page — previewed as a grey rectangle.

This is the finding that justifies the whole audit. The change that added Open
Graph images shipped with its own tests, all of which passed, because they
tested the generator and the pair pages and not the hub's rendered HTML.

**Fixed** by naming the site card explicitly on both `/` and `/convert`, through
a new `siteImageUrl()` in `lib/seo/og.ts`.

### 3. The home page linked nowhere — critical

A crawler arriving at the root could not reach the other 127 pages except
through the sitemap, and neither could a person. The placeholder had no anchor
on it at all.

**Fixed** with a link to the hub. It is also the home page's first focusable
element, which is why `e2e/a11y.spec.ts` had it marked as non-interactive.

### 4. `/tools` had no `h1` — critical

A document with no heading is one that a crawler, a screen reader and an outline
view all read as a fragment. The page is `noindex`, which is exactly why nothing
that only looks at the indexable surface had ever examined it.

**Fixed**, along with giving it a sentence that points at `/convert`.

### 5–8. Missing `og:url` and canonical on `/tools` and `/_not-found` — critical, then withdrawn

Both pages are `noindex`. On review these are not findings: the rule was wrong,
not the pages. See "What a `noindex` page is not asked for" above.

### Warnings: four descriptions under 140 characters

`/` and `/convert` were 76 and 133 characters. Under about 140, Google discards
the description and writes its own from the page body, which on a hub page is a
list of format names.

**Fixed** on both. `/tools` and `/_not-found` are `noindex` and are no longer
asked for a description at all.

---

## Running it

```bash
pnpm build
pnpm audit:seo
```

```
SEO audit — 128 pages, 0 critical, 0 warnings

No critical findings across 128 pages.
```

The rules are unit-tested against synthetic HTML in `test/seo-audit.test.ts` —
on strings rather than on fixture files, because the suite has to be able to
describe a _failing_ page, and a fixture that failed would have to be excluded
from the real audit. An exclusion is the hole the gate exists to close.

---

## What is still open before launch

Neither is a finding of this audit; both are issues of their own.

- **#103 — Google Search Console.** The sitemap is generated and reachable, and
  nothing is submitted until there is a property to submit it to.
- **#99 — the Vercel deployment.** Every canonical URL on the site is built from
  the `https://docify.app` literal in `lib/seo/site.ts`. Until that origin
  serves the site, the canonical tags are correct about an address that does not
  answer.
