# Deploying the app to Vercel

The runbook behind issue #99, and the companion to
[`docs/backend/render-deploy.md`](../backend/render-deploy.md) and
[`docs/backend/neon-provisioning.md`](../backend/neon-provisioning.md). Those two
describe optional pieces; this one describes the product.

## What is being deployed

128 statically generated pages, one route handler, and a set of WASM engines
served as static assets. There is no server-side rendering that depends on a
request, no session, and no file that reaches the platform — conversion runs in
the visitor's tab (CLAUDE.md §2.1). What Vercel provides is a CDN, the headers
`next.config.ts` declares, and one function that increments a counter.

## Why there is a `vercel.json` at all

Next.js on Vercel needs no configuration, and one of the defaults is wrong here
in the worst possible way: it produces a deployment that works.

`pnpm build` is `pnpm vendor && next build`. The vendor step copies the
wasm-vips, pdf.js and ffmpeg binaries out of `node_modules` into
`public/vendor/`, which `.gitignore` deliberately keeps out of the history. A
build that runs `next build` alone renders all 128 pages, passes every check a
crawler makes, scores well on Lighthouse — and serves a converter whose engines
404 the first time somebody drops a file.

So `buildCommand` is pinned, and `test/app/vercel-config.test.ts` keeps it
pinned to the same script the rest of the repository runs.

The rest of the file is short on purpose:

| Key              | Why                                                                                                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `framework`      | Declared rather than detected, so a future directory move cannot change it.                                                                                                             |
| `installCommand` | `--frozen-lockfile`, the same argument CI makes: a deploy that silently resolved a newer dependency is a deploy nobody can reproduce.                                                   |
| `regions`        | `fra1`. The site is static except for the counter route, so this is really a choice about where that route sits relative to Neon — pick the Neon region to match.                       |
| `functions`      | `maxDuration: 10` on the one route. The platform default is 300 seconds, and nothing here is a long-running job; a generous limit only decides how long a runaway invocation bills for. |

**No `headers`, `redirects` or `rewrites`.** `next.config.ts` owns all three, with
several paragraphs about why COOP, COEP and CORP are scoped the way they are.
Two sources for the isolation headers is how a converter page loses
`crossOriginIsolated` without anybody editing the file that documents it. The
test asserts their absence.

## First deploy

1. **Vercel → Add New → Project**, import this repository.
2. Vercel reads `vercel.json`; there is nothing to fill in on the build settings
   screen. Confirm it shows `pnpm build` and not `next build`.
3. Deploy. The first build takes several minutes — 128 pages plus the vendor
   copy.

`sharp` is denied in `pnpm-workspace.yaml` and `next.config.ts` sets
`images.unoptimized`; both are deliberate (issue #114) and neither needs
undoing here. Vercel supplies its own sharp for the image optimiser, and this
app does not use the image optimiser.

## Environment variables

Everything is optional. The app builds, deploys and serves every page with none
of them set — which is what makes a preview deployment usable without secrets.

| Variable                   | Environments        | Absent means                                                                     |
| -------------------------- | ------------------- | -------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Production, Preview | The anonymous counters are skipped; every route still works.                     |
| `GOOGLE_SITE_VERIFICATION` | Production only     | No Search Console verification tag is rendered — see docs/seo/search-console.md. |

```bash
vercel env add DATABASE_URL production
```

Never prefix any of these with `NEXT_PUBLIC_`. That prefix inlines a value into
the client bundle, which for a database credential is the one place it must
never be.

`.env.example` is the list. A variable that exists only in a dashboard is a
variable the next environment forgets.

## The custom domain

The canonical URL is `https://docify.app`, and it is a literal in
`lib/seo/site.ts` rather than an environment variable — deliberately, because a
canonical URL that varies by deployment is one that points a crawler at a
preview build from production.

That has a consequence worth stating plainly: **until the domain is attached,
every page's canonical tag, sitemap entry and Open Graph URL claims an address
the deployment does not answer on.** The `*.vercel.app` URL is correct for
verifying that the app works and wrong for anything a crawler does, so leave
Search Console (issue #103) until after this step.

1. **Project → Settings → Domains**, add `docify.app` and `www.docify.app`.
2. Point the registrar at Vercel's nameservers, or add the `A` / `CNAME` records
   the panel shows. HTTPS is provisioned automatically once the records resolve.
3. Keep the redirect Vercel proposes — one hostname serves, the other redirects.
   Two hostnames serving the same 128 pages is a duplicate-content problem the
   canonical tags would then have to argue their way out of.

## Verifying a deployment

```bash
curl -sI https://docify.app/ | head -20
curl -sI https://docify.app/convert/heic-to-jpg | grep -i cross-origin
curl -s  https://docify.app/robots.txt
curl -s  https://docify.app/api/stats
```

The second is the one that is easy to get wrong and invisible when it is: a
converter page must answer with `Cross-Origin-Opener-Policy: same-origin` and
`Cross-Origin-Embedder-Policy: require-corp`, or `crossOriginIsolated` is false
in the tab, `SharedArrayBuffer` is unavailable and the router quietly routes
around every engine that needs it. (`NO_ISOLATION` is not the signal to look
for: the vendored ffmpeg core is single-threaded whatever the headers say, so
that warning fires on a correctly isolated deployment too.)

The last returns `{"available":false}` rather than an error when `DATABASE_URL`
is unset. That is the designed behaviour, not a broken deployment
(`test/app/backend-degradation.test.ts`).

## Rolling back

**Deployments → the previous one → Promote to Production.** It is instant and it
is why the app auto-deploys from `main` while the Render service does not: this
side is reversible in seconds, and that side is a network reachable from inside
a hosting provider.
