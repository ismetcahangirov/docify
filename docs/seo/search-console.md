# Google Search Console

The runbook behind issue #103: verify ownership of
`docify-convert.vercel.app`, submit the sitemap, and know which of the reports
are worth reading afterwards.

## Do this after the project is named

Not before. `SITE_ORIGIN` is a literal in `lib/seo/site.ts`, so every canonical
tag, every sitemap entry and every Open Graph URL already claims
`https://docify-convert.vercel.app` — including on a preview deployment, where
all of them point at an address that deployment does not answer on.

Verifying any other URL as a property would therefore submit a sitemap of 126
URLs on a different origin, and Search Console would report every one of them as
excluded. See the address section of
[`docs/deploy/vercel.md`](../deploy/vercel.md).

## Verify ownership

Use a **URL-prefix property**, verified by the meta tag.

This is the opposite of the general advice, and the reason is the address
(issue #303). A domain property is verified by a DNS TXT record, and a TXT
record needs a zone — `vercel.app` is Vercel's, not ours. There is no registrar
in this deployment and therefore no domain property to have.

That costs less here than it would elsewhere, because the things a domain
property buys are things this address does not have: there is no `www`
hostname, no second subdomain, and no `http` origin Vercel does not already
redirect. One URL-prefix property covers the whole site.

1. Search Console → **Add property** → **URL prefix** →
   `https://docify-convert.vercel.app`.
2. Choose the **HTML tag** method. Google shows a
   `<meta name="google-site-verification" content="…">` line behind a copy
   button.
3. Set it and rebuild — the tag is generated at build time, so it appears in the
   next deployment and not in the running one:

   ```bash
   vercel env add GOOGLE_SITE_VERIFICATION production
   vercel --prod
   ```

4. **Verify.** Confirm the tag is actually being served first, or the console
   reports a failure that says nothing about which half is wrong:

   ```bash
   curl -s https://docify-convert.vercel.app/ | grep google-site-verification
   ```

Keep the variable set. Google re-checks the tag, and removing it un-verifies the
property.

### What the variable accepts

`GOOGLE_SITE_VERIFICATION` renders the tag into every page via
`lib/seo/verification.ts`, which is written for exactly this path — its own
header names "a deployment that is not the apex domain" as the case it exists
for.

It accepts either the bare token or the whole `<meta …>` line the console offers
behind its copy button; the tag is unwrapped, and anything that is still not a
token is dropped rather than rendered.

Set it in **Production only**. A preview deployment carrying the tag is a second
address claiming to own the property.

### When a bought domain arrives

Add a **domain property** then, verify it with the TXT record, and keep both
until the redirect has been in place long enough for the reports to move. The
meta tag costs nothing to leave in place meanwhile.

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

## Bing

Verified the same way, with its own token (issue #307).

Bing Webmaster Tools can also import a verified Search Console property in two
clicks, and that used to be the recommendation here. It is the weaker option on
a free subdomain: the verification becomes a link between two consoles rather
than a fact stated in the repository, so it cannot be reviewed in a diff, rolled
back, or carried to a bought domain the way a literal can. `render.yaml` makes
the same argument about the proxy.

1. [Bing Webmaster Tools](https://www.bing.com/webmasters) → **Add a site** →
   `https://docify-convert.vercel.app`.
2. Choose the **HTML Meta Tag** option. Bing shows
   `<meta name="msvalidate.01" content="…" />`.
3. Set it and rebuild — the tag is generated at build time, so it appears in the
   next deployment and not in the running one:

   ```bash
   vercel env add BING_SITE_VERIFICATION production
   vercel --prod
   ```

4. Confirm it is being served before pressing **Verify**:

   ```bash
   curl -s https://docify-convert.vercel.app/ | grep msvalidate
   ```

Then submit `sitemap.xml` here too. Bing's index is what several of the AI
products cite from, which is why `app/robots.ts` names seventeen AI crawlers
explicitly and allows them — the reasoning is in that file.

`lib/seo/verification.ts` renders both tags independently: either token alone
renders alone, and neither set renders no block at all.
