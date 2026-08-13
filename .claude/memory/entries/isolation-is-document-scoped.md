---
name: isolation-is-document-scoped
description: crossOriginIsolated is per-document, not per-device — it must never be cached alongside the rest of Capabilities
type: gotcha
date: 2026-08-13
---

COOP/COEP are scoped to /convert/* and /tools/* in next.config.ts, but sessionStorage
lives for the whole tab. Caching a whole probed `Capabilities` object therefore freezes
`crossOriginIsolated` at whatever the first-visited page happened to be.

Both directions are broken, and neither fails loudly:

- Land on `/` then navigate to `/convert/...` — isolation reads false forever, so
  ffmpeg.wasm is denied its threads and the user gets a bogus NO_ISOLATION warning on a
  page that is genuinely isolated.
- Land on `/convert/...` then navigate to `/` — isolation reads true, the router promises
  a SharedArrayBuffer that does not exist there, and the job dies at runtime.

`lib/router/capabilities.ts` therefore caches only the *device* half of `Capabilities` and
reads `crossOriginIsolated` live on every call. It is the one field in that interface that
is document-scoped rather than device-scoped; anything added to `Capabilities` later needs
the same question asked of it.

Found in code review on issue #23, before the probe shipped.

Related: [[coep-require-corp-scoped]], [[no-server-side-processing]]
