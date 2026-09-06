---
name: "analytics-count-views-never-visitors"
description: "The analytics deliberately cannot count visitors — every hosted product identifies one, and the schema says Docify holds no address hashed or otherwise"
type: "decision"
date: "2026-09-04"
---

Issue #102 asked for "privacy-first analytics, cookieless, consistent with the
privacy positioning". The obvious answer was a hosted product — Plausible,
Fathom, Vercel Web Analytics. It was rejected, and the reason is not visible
from anything in the tree.

## The argument

Every one of those products is honest about being cookieless, and every one of
them counts **visitors** — which requires telling two of them apart. The
mechanism is no longer a cookie; it is typically a daily rotating hash of the IP
address and the user agent. That is a pseudonymous identifier however short its
life.

`lib/db/schema.sql` states, in the file itself, that Docify holds *no IP
address, hashed or otherwise*. Adopting a product that computes one somewhere
else would have left that sentence true about the database and false about the
system. `lib/api/client-key.ts` goes to considerable length to hash an address
with a per-process salt, truncate it to 64 bits and never persist it, purely so
a rate limiter can exist; adopting a vendor that does the same thing durably
would make that module theatre.

So: **page views, not visitors.** `page_totals` holds one number per page per
day. Two people opening a page and one person opening it twice are the same row,
and there is no column that could tell them apart.

## What that costs, and why it was accepted

Unique visitors, sessions, bounce rate, time on page and referrer are questions
this schema cannot answer — ever, not "not yet". That is a real loss and it is
written down in `docs/backend/analytics.md` rather than glossed.

It was accepted because Search Console answers the referrer question for search
traffic, which is the traffic a programmatic-SEO site is built for, with no
beacon at all. The remaining questions were not worth a visitor identifier.

## Three things that follow from the decision

**The path is validated, not stored as sent.** A `text` column holding whatever
path a client reported is how a counter becomes a log — a path can carry a query
string, an id, or a token somebody pasted into a URL. `lib/db/parse-view.ts`
refuses anything outside the 126 routes `app/sitemap.ts` publishes, so the
strongest statement about the table stays structural: nothing in it was not
already public. `?utm_source=` is harmless and `?email=` is not, and the column
cannot tell them apart.

**There is no `GET /api/views`.** `GET /api/stats` exists because a page shows
those figures. Nothing shows these; `pnpm analytics` reads them behind the
connection string. Publishing which pages get traffic would be a decision, and a
route handler added while passing through is a poor way to make one.

**The beacon is scheduled, never sent from the effect.** Hydration is the window
the paint and interaction budgets are measured in.
`components/analytics/page-view.tsx` uses `requestIdleCallback` with a
four-second timeout so a backgrounded tab still reports. The same reasoning as
[[converter-is-a-deferred-island]].

## The trap this set, once

An idle-scheduled request lands at a moment nobody controls.
`e2e/canvas-engine.spec.ts` recorded *every* request during a conversion and
asserted the list was empty — correct while the app made no requests at all.
After #102 it was a race: green on the pull request, red on `main`, same tree
(#258). An assertion about "no network" has to name what it excludes once
anything on the page is allowed to talk.

Related: [[no-server-side-processing]], [[monochrome-design-constraint]]
