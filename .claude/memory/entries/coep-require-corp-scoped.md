---
name: coep-require-corp-scoped
description: COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only
type: decision
date: 2026-08-13
---

Cross-origin isolation is set in `next.config.ts` via `headers()`, on
`/convert/:path*` and `/tools/:path*` only:

```
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
```

Two decisions are baked in here, and neither is visible from the code.

**Why scoped, not site-wide.** `require-corp` blocks every cross-origin
subresource that does not opt in with CORP or CORS. Applying it globally would
silently break anything third-party a marketing page ever wants to load —
embeds, pixels, an analytics script. The isolation is only needed where
`SharedArrayBuffer` is: the converter surface. So marketing pages deliberately
report `crossOriginIsolated === false`, and that negative half is a requirement,
not an accident. Any test for this must assert both halves, or it would pass
even if the headers leaked site-wide.

**Why `require-corp` and not `credentialless`.** `credentialless` is the
tempting option because it strips credentials from no-cors cross-origin requests
instead of demanding CORP on every subresource. That convenience buys us nothing
here: every asset on the converter routes is same-origin by design (WASM engines
ship from `/_next/static`, fonts are self-hosted, and no file ever leaves the
device), and same-origin responses satisfy `require-corp` without any extra
header. Meanwhile `credentialless` has no Safari support, so choosing it would
cost iOS and macOS Safari users cross-origin isolation entirely — no
`SharedArrayBuffer`, no multi-threaded ffmpeg.wasm, a permanent `NO_ISOLATION`
warning on the platform with the tightest memory ceiling. `require-corp` is
supported by Chromium, Firefox and Safari alike. We pay zero for the stricter
policy and gain a whole browser engine.

Revisit only if the converter routes ever need a genuinely cross-origin
subresource that we cannot serve CORP headers for.

Related: [[webcodecs-over-ffmpeg]], [[no-server-side-processing]]
