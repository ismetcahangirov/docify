# Deploying the URL import proxy to Render

The runbook behind issue #100. The service itself — what it does, why it exists,
and the three layers of SSRF protection in front of it — is documented in
[`services/url-proxy/README.md`](../../services/url-proxy/README.md). This file
is only about getting it running.

## What is being deployed

One Node process with **no runtime dependencies**, described by
[`render.yaml`](../../render.yaml) at the repository root. It reads bytes from a
URL a visitor typed and writes them straight back out to that visitor's browser.
It stores nothing, on disk or in memory, and it never sees a file chosen from
somebody's own machine — those never leave the tab.

## Create the service

1. **Render → New → Blueprint**, and pick this repository.
2. Render reads `render.yaml`, proposes one web service named `docify-url-proxy`,
   and lists the four environment variables it declares. Apply it.
3. The first build runs `npm install --include=dev && npm run build` inside
   `services/url-proxy`. `--include=dev` is not decoration: Render sets
   `NODE_ENV=production`, `npm install` under that skips `devDependencies`, and
   `typescript` is the service's only one. Without the flag the build fails with
   `tsc: not found` after passing on every developer machine.

Everything in the blueprint is checked against its source by
`test/services/url-proxy/render-blueprint.test.ts`, so a rename inside the
service breaks the unit job rather than the deploy.

## Verify it

Health first. No origin is required — Render polls this, and a misconfigured
allowlist must not make a healthy service look dead.

```bash
curl -i https://docify-url-proxy.onrender.com/healthz
```

Then an import, as the browser makes it. The `Origin` header is the whole
authorisation model; without it the answer is `403` by design.

```bash
curl -i -H "Origin: https://docify.app" "https://docify-url-proxy.onrender.com/fetch?url=https%3A%2F%2Fexample.com%2Fimage.png"
```

Then the SSRF guard, from outside. Expect `400` and an `x-proxy-refused` header
naming the check that refused it.

```bash
curl -i -H "Origin: https://docify.app" "https://docify-url-proxy.onrender.com/fetch?url=http%3A%2F%2F169.254.169.254%2Flatest%2Fmeta-data%2F"
```

The third one is the one worth running on every deploy. A URL import proxy is a
request-forgery primitive with a friendly name, and the only interesting question
about a new instance is whether the guard came with it.

## The free plan, and what it costs

A free Render instance sleeps after 15 minutes without traffic, and the first
request after that waits roughly a minute while it boots.

That is acceptable here and would not be for the app itself. The service holds
no state, so a cold start costs a boot and nothing else; the ceiling that matters
— 100 MiB per transfer — is enforced in code rather than by the plan; and the
feature it backs is one a visitor opts into by pasting a URL, not something on
the path of every page load. If a first import routinely times out in the
browser before the instance wakes, the fix is a paid instance, not a change here.

## Configuration

`render.yaml` declares all four variables, so there is nothing to type into the
dashboard on a first deploy. The one that has to be right is `ALLOWED_ORIGINS`:
it is the entire authorisation model, and an empty value means **nobody** rather
than everybody. That default is deliberate — an open proxy is somebody else's
bandwidth bill and somebody else's abuse report.

Add a second origin only by editing the blueprint, so the allowlist stays
reviewable in the history:

```yaml
- key: ALLOWED_ORIGINS
  value: https://docify.app,https://www.docify.app
```

## Auto-deploy is off

`autoDeploy: false`. A deploy of this service is a decision rather than a side
effect of a merge: the app moves with `main` on Vercel and can be rolled back in
seconds, whereas this is the piece with a network reachable from inside a
hosting provider. Deploy it from the Render dashboard when a change to
`services/url-proxy/` has landed and been read.

## Wiring the app to it

Not yet done, and deliberately not part of this issue. Nothing under `app/` or
`components/` calls the proxy today; the import-from-URL affordance is its own
piece of UI work. When it lands, the service origin belongs in `.env.example`
next to `DATABASE_URL`, and the page has to keep working when that fetch fails —
the same rule the counters follow (`test/app/backend-degradation.test.ts`).
