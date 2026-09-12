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

| Variable                   | Environments        | Read at      | Absent means                                                                     |
| -------------------------- | ------------------- | ------------ | -------------------------------------------------------------------------------- |
| `DATABASE_URL`             | Production, Preview | request time | The anonymous counters are skipped; every route still works.                     |
| `GOOGLE_SITE_VERIFICATION` | Production only     | build time   | No Search Console verification tag is rendered — see docs/seo/search-console.md. |
| `NEXT_PUBLIC_PROXY_URL`    | Production          | build time   | The converter's "from a URL" control renders nothing — see the Render runbook.   |
| `BING_SITE_VERIFICATION`   | Production only     | build time   | No Bing ownership tag is rendered — see docs/seo/search-console.md.              |

```bash
vercel env add DATABASE_URL production
vercel env add NEXT_PUBLIC_PROXY_URL production
```

`NEXT_PUBLIC_PROXY_URL` is **Production only**, and that is not an oversight
either. A preview deployment is served from
`docify-convert-<hash>-<team>.vercel.app`, which is not in the proxy's
`ALLOWED_ORIGINS` — setting it there would render a control that answers `403`
every time. Left unset, the control does not render at all, and a preview is an
ordinary Docify without URL import.

**The "read at" column is the one that wastes an afternoon.** Only
`DATABASE_URL` is consulted per request. The other two reach the deployment
through a build: `GOOGLE_SITE_VERIFICATION` is baked into generated metadata,
and `NEXT_PUBLIC_PROXY_URL` is inlined into the client bundle as a literal by
the prefix itself. Setting either in the dashboard changes nothing about the
deployment already running — **redeploy, or it did not happen.**

That prefix is also the reason `DATABASE_URL` must never carry it: it puts the
value in the client bundle, which for a database credential is the one place it
must never be. `NEXT_PUBLIC_PROXY_URL` carries it correctly — the browser is
what calls the proxy, and the address of a public endpoint is not a secret.

`.env.example` is the list, and `test/app/env-example.test.ts` keeps it the
list: a variable the code reads and that file omits fails the unit job (issue
#302). A variable that exists only in a dashboard is a variable the next
environment forgets.

## The address

The canonical URL is `https://docify-convert.vercel.app`, and it is a literal in
`lib/seo/site.ts` rather than an environment variable — deliberately, because a
canonical URL that varies by deployment is one that points a crawler at a
preview build from production.

**It is a free Vercel subdomain, and it is therefore not something to attach —
it is something to claim by naming the project** (issue #303). Name the Vercel
project `docify-convert` and the deployment answers on
`docify-convert.vercel.app`. Name it anything else and every canonical tag on
the site points at a host somebody else controls, which is worse than having no
canonical tag at all. `docify.vercel.app` and `docify-app.vercel.app` were
already taken; that is why the name is what it is.

So there is nothing to do at a registrar, and three consequences follow from
that:

- **No `www`.** A `vercel.app` subdomain has no second hostname, so the
  duplicate-content question this section used to spend a paragraph on does not
  arise, and `render.yaml` needs exactly one origin in its allowlist.
- **No DNS record**, which changes how Search Console verification works —
  `docs/seo/search-console.md` covers it.
- **Moving to a bought domain later** is the literal in `lib/seo/site.ts`, the
  allowlist in `render.yaml`, and a redirect. It is cheapest before there is
  indexed history to carry across, and `test/seo/site-origin.test.ts` asserts
  there is no third place to remember.

## Verifying a deployment

```bash
curl -sI https://docify-convert.vercel.app/ | head -20
curl -sI https://docify-convert.vercel.app/convert/heic-to-jpg | grep -i cross-origin
curl -s  https://docify-convert.vercel.app/robots.txt
curl -s  https://docify-convert.vercel.app/api/stats
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
