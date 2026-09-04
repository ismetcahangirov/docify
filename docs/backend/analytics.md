# Analytics

What Docify measures about the people who use it, and what it deliberately
cannot. The runbook behind issue #102.

## The short version

One number per page per day. That is all of it.

```
page                      day         total
/convert/heic-to-jpg      2026-09-04    412
/                         2026-09-04     97
```

No cookies, no local storage, no visitor identifier, no referrer, no country,
no device, no session, no duration, no bounce rate. Not configured off —
absent. There is no column for any of them
([`lib/db/schema.sql`](../../lib/db/schema.sql)), and
`test/db/schema.test.ts` fails if one appears.

## Why this and not a hosted product

Plausible, Fathom, Vercel Web Analytics and the rest are all honest about being
cookieless, and all of them count **visitors** — which means telling two of them
apart. The mechanism is no longer a cookie; it is typically a daily rotating
hash of the IP address and the user agent. That is a pseudonymous identifier,
however short its life.

`lib/db/schema.sql` says, in the file itself, that Docify holds no IP address,
hashed or otherwise. Adopting a product that computes one somewhere else would
leave that sentence true about the database and false about the system, and the
acceptance criterion for this work was "consistent with the privacy
positioning".

So the answer here is narrower and honest: **page views, not visitors.** Two
people opening a page and one person opening it twice are the same row, and
there is no way to ask which happened.

## What that costs

A real limit, stated rather than glossed:

| Question                              | Answerable                                              |
| ------------------------------------- | ------------------------------------------------------- |
| Which pages get opened, and how often | yes                                                     |
| Which day traffic arrived             | yes                                                     |
| How many unique visitors              | **no**                                                  |
| Sessions, bounce rate, time on page   | **no**                                                  |
| Where visitors came from              | **no** — Search Console answers this for search traffic |
| Which country, browser or device      | **no**                                                  |

Several of those are genuinely worth having, and none of them is worth a
visitor identifier. Search Console (see [`docs/seo/search-console.md`](../seo/search-console.md))
answers the referrer question for the traffic that matters most to a
programmatic-SEO site, without any beacon at all.

## How it works

Four pieces, and each is small:

| Piece                                | What it does                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `components/analytics/page-view.tsx` | One client component in the root layout. Renders nothing. Schedules one beacon per path, behind `requestIdleCallback`. |
| `lib/analytics/report.ts`            | Puts exactly one field on the wire and never returns a promise.                                                        |
| `app/api/views/route.ts`             | `POST` only. Rate-limited, 202 for everything the caller cannot act on.                                                |
| `lib/db/parse-view.ts`               | Refuses any path that is not one of the site's own routes.                                                             |

Two decisions in there are worth knowing about.

**The report is scheduled, not sent during hydration.** An effect runs at the
busiest moment of the page's life, inside the window the paint and interaction
budgets are measured in. `requestIdleCallback` — with a four-second timeout, so
a backgrounded tab still reports — moves it behind everything the visitor can
see. The count is no less accurate for arriving late.

**The path is validated against the route list, not stored as sent.** A `text`
column holding whatever path a client reported is how a counter becomes a log:
a path can carry a query string, a fragment, an id, or a token somebody pasted
into a URL. `parsePageView` refuses anything that is not one of the 126 routes
`app/sitemap.ts` publishes, so the strongest statement about the table stays a
structural one — there is nothing in it that was not already public.

## Reading the figures

```bash
pnpm analytics                    # busiest 20 pages, last 30 days
pnpm analytics --days 7 --top 50
```

It needs `DATABASE_URL`, which is the same threshold `pnpm db:migrate` uses.

There is no `GET /api/views`, deliberately. `GET /api/stats` exists because a
page shows those figures; nothing shows these. Publishing which pages get
traffic would be a decision, and adding a route handler "while we are here" is
a strange way to make one.

## What the numbers do not include

**Crawlers, mostly.** The beacon needs JavaScript, and most crawlers do not run
it. Whatever GPTBot and Googlebot are doing shows up in Search Console and in
the hosting provider's logs, not here. That makes these figures a better
approximation of humans than a server log would be, and it also means they are
not a traffic total.

**Anyone who blocks beacons.** A privacy extension that blocks `/api/views`
gets a page that works exactly as well as everybody else's, which is the
correct outcome. `lib/analytics/report.ts` swallows every failure silently —
the same rule the conversion counter follows, and the same reason `#86` holds.

## When there is no database

Nothing happens, and nothing breaks. `lib/db/neon.ts` returns `null` without a
connection string, `recordPageView` answers `false`, and the route still returns
202 — the visitor cannot tell and must not be able to. Every preview
deployment and every local build runs in exactly that state.
