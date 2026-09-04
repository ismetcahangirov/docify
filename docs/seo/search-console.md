# Google Search Console

The runbook behind issue #103: verify ownership of `docify.app`, submit the
sitemap, and know which of the reports are worth reading afterwards.

## Do this after the domain is attached

Not before. `SITE_ORIGIN` is a literal in `lib/seo/site.ts`, so every canonical
tag, every sitemap entry and every Open Graph URL already claims
`https://docify.app` — including on a `*.vercel.app` deployment, where all of
them point at an address that deployment does not answer on.

Verifying the Vercel URL as a property would therefore submit a sitemap of 126
URLs on a different origin, and Search Console would report every one of them as
excluded. See the domain section of [`docs/deploy/vercel.md`](../deploy/vercel.md).

## Verify ownership

Use a **domain property**, not a URL-prefix property.

A domain property verifies `docify.app` and everything under it at once: `www`,
any future subdomain, `http` and `https` alike. A URL-prefix property verifies
one origin, which means `https://docify.app` and `https://www.docify.app` are
two properties with two sets of reports and half the data each.

1. Search Console → **Add property** → **Domain** → `docify.app`.
2. Google shows one TXT record. Add it at the registrar — the same place the
   Vercel records went.
3. **Verify.** Propagation is usually minutes; the button can be pressed again.

Keep the TXT record. Google re-checks it, and removing it un-verifies the
property.

### The meta-tag fallback

`GOOGLE_SITE_VERIFICATION` renders
`<meta name="google-site-verification" content="…">` into every page, via
`lib/seo/verification.ts`. It exists for the cases the DNS record cannot cover —
verifying before DNS has moved, or verifying a deployment that is not the apex
domain — and it verifies a URL-prefix property only.

```bash
vercel env add GOOGLE_SITE_VERIFICATION production
```

Set it in **Production only**. A preview deployment carrying the tag is a second
address claiming to own the property.

The variable accepts either the bare token or the whole `<meta …>` line the
console offers behind its copy button; the tag is unwrapped and anything that is
still not a token is dropped rather than rendered. Redeploy after setting it —
the metadata is generated at build time, so the tag appears in the next build
and not in the running one.

## Submit the sitemap

**Sitemaps → Add a new sitemap → `sitemap.xml`.**

`app/sitemap.ts` generates it from the same `pageMetadata()` call that produces
each page's canonical tag, and `test/app/sitemap.test.ts` asserts the two are
the same string. That matters here: when a sitemap URL and a page's canonical
tag disagree, the crawler is told to fetch one address and then told by the page
that the real one is somewhere else — and it believes the page.

`app/robots.ts` already names the sitemap, so a crawler that arrived from a link
finds it without this step. Submitting it is what makes the _coverage report_
possible, which is the actual reason to do it.

Expect 126 URLs: the home page, `/convert`, and 124 conversion pages. `/tools`
is deliberately absent — it carries `robots: { index: false }` while it is a
placeholder, and submitting a `noindex` page is a contradiction that Search
Console reports back as a warning.

## What to read afterwards

Three reports, in the order they become useful:

- **Pages** (indexing). The number to watch in the first month is how many of
  the 126 are indexed. Programmatic pages get sampled rather than crawled
  wholesale; a slow ramp is normal, and a page excluded as _Duplicate, Google
  chose a different canonical_ is the one that means the copy for that pair is
  not different enough from its neighbour's — which is what
  `scripts/check-content-uniqueness/` exists to prevent before it reaches this
  report.
- **Performance**, filtered by page. This is the only place that says which
  conversion pairs people actually search for. The demand tiers in
  `lib/registry/pairs.ts` were a judgement made before any traffic existed;
  this report is what should eventually correct them.
- **Core Web Vitals**. Field data, and therefore the real answer to the question
  the Lighthouse gate only approximates. `.claude/memory/entries/lighthouse-numbers-come-from-ci.md`
  records why a lab number measured anywhere is not the number a visitor gets.

## Bing and the rest

Not set up, and not an oversight. Bing Webmaster Tools can import a verified
Search Console property in two clicks, which is the moment to do it — after
this. `app/robots.ts` already names the AI crawlers explicitly and allows them,
with the reasoning in that file.
