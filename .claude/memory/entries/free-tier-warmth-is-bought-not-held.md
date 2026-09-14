---
name: "free-tier-warmth-is-bought-not-held"
description: "The URL proxy is woken on intent rather than held awake, because Render's 750 free hours a month is 6 hours more than a 31-day month"
type: "decision"
date: "2026-09-14"
---

`services/url-proxy` runs on a free Render instance. A free instance sleeps
after 15 quiet minutes and takes about a minute to boot, so the first URL
import on a quiet site looks like a control that does nothing.

The obvious fix — a cron hitting `/healthz` every ten minutes — was rejected,
and the number is the reason.

## The number

Render allocates **750 free instance hours a month, per workspace**, shared
across every free service in it. Not per service.

| | |
| --- | --- |
| 30-day month, 24/7 | 720 h |
| 31-day month, 24/7 | **744 h** |
| Allowance | 750 h |

It fits. It fits by six hours, in the months where it fits at worst, and only
while this is the *only* free service in the workspace. A second one added
later does not halve the margin — it ends both services partway through the
month. Spending the entire free allowance so that an opt-in control is faster
is the wrong trade, and an external cron is also a dependency whose failure is
silent: nothing in the repository would notice it had stopped.

## What was done instead

`warmUrlImport()` in `lib/import/url.ts`, called from the URL field's `onFocus`
in `components/converter/url-import.tsx`, throttled to one knock per ten
minutes by a ref.

Three things about it are load-bearing and not obvious:

- **`/healthz` is the right path** because `proxy.ts` answers it *before* the
  origin allowlist and *before* the rate limiter. A warm-up therefore needs no
  origin to be allowed and spends none of `RATE_LIMIT_PER_MINUTE`.
- **`mode: 'no-cors'`** follows from that: answered that early, it carries no
  CORS headers, so the response is opaque. Nothing reads it. The request
  arriving is the entire payload.
- **It returns `void` and swallows its own rejection.** There is no outcome a
  caller could act on, and an unhandled rejection would be the only thing a
  visitor ever learned about a feature they have not used yet.

## What it does not buy

Not the minute. A boot is about a minute and pasting a URL takes a few seconds,
so what it recovers is those seconds — they now overlap the boot instead of
following it. The honest claim is small. It is worth making because it costs
nothing in the case the free plan is chosen for: nobody using the feature
spends no hours at all.

`docs/backend/render-deploy.md` still holds the line it always held — if a
first import routinely times out in the browser before the instance wakes, the
answer is a paid instance, not a cleverer warm-up.

Related: [[url-import-was-retired-then-shipped]],
[[deployment-runs-on-three-free-tiers]], [[no-server-side-processing]]
