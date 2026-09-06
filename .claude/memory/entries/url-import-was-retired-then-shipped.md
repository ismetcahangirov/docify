---
name: "url-import-was-retired-then-shipped"
description: "URL import was decided retired on 2026-09-05 and shipped on 2026-09-06 — the reasons for retiring did not stop being true, and its prerequisite #269 had been closed unimplemented"
type: "decision"
date: "2026-09-06"
---

On 2026-09-05 the owner decided **Option B on #270: retire the url-proxy**, and
wrote four reasons on the issue. On 2026-09-06 the owner reversed it and asked
for Option A. The feature shipped. Both halves are recorded here because the
reasons for retiring were good ones and they did not stop being true.

## What the retire decision said, and what shipping had to answer

| The objection | What the shipped feature does about it |
| --- | --- |
| "The product's whole claim is that no server touches files" | The claim is about *the visitor's own files*, and it is untouched. What leaves the tab is a URL typed into a box. The distinction is written out in `lib/import/url.ts`, `components/converter/url-import.tsx` and the README's Privacy section, because it is the first thing a sceptical reader will test. |
| "A network-reachable fetch proxy with SSRF surface earns nothing while unused" | It is no longer unused. The surface is unchanged and was already guarded (`url-guard.ts`, `safe-lookup.ts`, `ip-ranges.ts`, #88). |
| "A free Render instance sleeps after 15 minutes, so the first fetch waits a minute" | Still true, and not solved. It is why the control sits *below* the dropzone rather than beside it, and why the unreachable-proxy message says "It may be waking up — try again." |
| "Nothing calls it and there is no UI" | `UrlImport` renders nothing at all when `NEXT_PUBLIC_PROXY_URL` is unset, so a checkout without a proxy is an ordinary Docify rather than a broken one. |

## The trap in the issue

Option A's step 5 read "Depends on #269 landing first" — and **#269 had been
closed unimplemented**, as "superseded by the decision to retire". So the
prerequisite looked done and was not. Shipping Option A on its own would have
put a UI in front of a proxy with no total transfer timeout, no rate limit and
`Origin` as its only access control: an open 100 MiB-per-request proxy on the
owner's Render bandwidth, advertised from every conversion page.

#269 was reopened and done in the same pull request.

**The general shape:** an issue closed as *superseded* is not an issue that was
*solved*. When a decision is reversed, every issue that decision closed has to
be reopened with it, and a closed dependency is worth reading rather than
counting.

## What #269 turned out to be

Three defects, all of them the kind that only bite in production:

1. `createGuardedFetch` ignored `init.signal` outright, so the
   `AbortSignal.timeout` `proxy.ts` had always passed did nothing. The `timeout`
   given to `node:http` is a *socket idle* timeout: an upstream trickling one
   byte every 29 seconds renews it forever.
2. `Origin` is set honestly by browsers and by nobody else. The allowlist was
   being asked to do a job CORS cannot do.
3. No rate limit at all.

The limiter is keyed on the **last** `x-forwarded-for` hop with the socket
address underneath it, for the reason `lib/api/client-key.ts` already gives —
the first entry is whatever the caller typed. `rate-limit.ts` and
`client-key.ts` are *copied* into the service rather than imported: Render
deploys `services/url-proxy` as its `rootDir` and never sees the rest of the
repository, so an import across that boundary builds locally and fails there.

Related: [[no-server-side-processing]], [[coep-require-corp-scoped]], [[pr-open-checklist]]
