---
name: "coep-require-corp-scoped"
description: "COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only"
type: "decision"
date: "2026-08-13"
---

Cross-origin isolation is set in `next.config.ts` via `headers()`, on
`/convert/:path*` and `/tools/:path*` only:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Three things are baked in here, and none of them is visible from the code.

## Why scoped, not site-wide

`require-corp` blocks every cross-origin subresource that does not opt in with
CORP or CORS. Applying it globally would silently break anything third-party a
marketing page ever wants to load — embeds, pixels, an analytics script. The
isolation is only needed where `SharedArrayBuffer` is: the converter surface. So
marketing pages deliberately report `crossOriginIsolated === false`, and that
negative half is a requirement, not an accident. Any test for this must assert
both halves, or it would pass even if the headers leaked site-wide.

## Why `require-corp` and not `credentialless`

`credentialless` is the tempting option because it strips credentials from
no-cors cross-origin requests instead of demanding CORP on every subresource.
That convenience buys us almost nothing here: every *subresource* on the
converter routes is same-origin by design — WASM engines ship from
`/_next/static`, fonts are self-hosted, and no file ever leaves the device — and
same-origin responses are not subject to the CORP check at all. The one planned
cross-origin dependency, the Render URL-import proxy (plan task 10.5), is
consumed via a CORS-mode `fetch`, which satisfies COEP without needing CORP.

Meanwhile `credentialless` has no Safari support, so choosing it would cost iOS
and macOS Safari users cross-origin isolation entirely — no `SharedArrayBuffer`,
no multi-threaded ffmpeg.wasm, a permanent `NO_ISOLATION` warning on the platform
with the tightest memory ceiling. `require-corp` is supported by Chromium,
Firefox and Safari alike. We pay nothing for the stricter policy and gain a whole
browser engine.

## Isolation does not survive a soft navigation

COOP and COEP are evaluated once, when the **document** is created. A Next.js
`<Link>` does a client-side soft navigation: same document, no new response, no
re-evaluation. `crossOriginIsolated` is fixed for the life of the document, so
scoping breaks in both directions unless navigation across the boundary is a
*hard* navigation:

- `/` → `<Link href="/convert">` lands on a converter route with
  `crossOriginIsolated === false`. The router quietly takes the single-threaded
  ffmpeg path and emits `NO_ISOLATION`. It will look like a router bug.
- `/convert` → `<Link href="/">` lands on a marketing page still carrying COEP,
  so third-party embeds there are blocked — exactly what the scoping exists to
  prevent.

Therefore: **links that cross the marketing ↔ converter boundary must be plain
`<a href>`, not `next/link`.** And the eventual e2e test (deferred to the
Playwright setup issue) must use `page.goto()` per route rather than clicking
through, or it will fail for reasons that have nothing to do with the headers.

## Revisit triggers

- A converter route needs a cross-origin resource consumed in **no-cors** mode
  (`<img src>`, `<video src>`, a classic `<script src>`) — that origin must then
  send `Cross-Origin-Resource-Policy: cross-origin`. A CORS-mode `fetch` does not
  need this.
- `assetPrefix` is pointed at a CDN host, or a remote `<img>` is added to a
  converter route. Both turn same-origin assets cross-origin and COEP will block
  them.
- A live converter surface is ever placed on a route outside `/convert/*` and
  `/tools/*` — the homepage dropzone is the obvious candidate. It would not be
  isolated, on the highest-traffic entry point.

## The rule is now enforced by turning a lint rule off

`@next/next/no-html-link-for-pages` fires on every one of these deliberate plain
anchors, and it started firing the moment `/convert/[pair]` and `/convert`
became real pages (issue #66). It is switched off in `eslint.config.mjs`, with
the reasoning written out there — leaving it on would mean an inline disable
comment on every cross-boundary link and a new one on each link added
afterwards, which is a convention that survives exactly as long as whoever
remembers it.

Practically: every link written in `app/convert/*`, `components/blocks/related-tools.tsx`
and `components/converter/rejection.tsx` is a plain `<a href>`, and none of them
is marked as an exception, because they are the rule.

Related: [[webcodecs-over-ffmpeg]], [[no-server-side-processing]], [[converter-is-a-deferred-island]]
