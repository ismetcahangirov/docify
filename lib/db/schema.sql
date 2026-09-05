-- Docify's entire server-side data model.
--
-- Two tables of counters. No accounts, no sessions, no request log, and no
-- column that could hold a file name, an address or a person — see CLAUDE.md
-- section 2.1 and the plan's task 10.1. What follows is not a subset of a
-- larger schema kept elsewhere; it is all of it.
--
-- Apply it with `pnpm db:migrate`, or with
-- `psql "$DATABASE_URL" -f lib/db/schema.sql`. Every statement is idempotent,
-- so re-applying it on a deploy is a no-op rather than an error.
--
-- ## Why a row is a group and never a person
--
-- The primary key is the four dimensions together, so a row means "this many
-- conversions of this kind, of roughly this size, ended this way, on this day"
-- and cannot mean anything narrower. Each dimension is a closed vocabulary
-- enforced twice: by `parseConversionEvent` in lib/db/events.ts before the
-- write, and by a CHECK constraint here in case a future caller forgets.
--
--   pair         one of the 125 slugs in lib/registry/pairs.ts — the same list
--                app/sitemap.ts already publishes, so nothing here was private
--   outcome      success | failure
--   size_bucket  five buckets across four orders of magnitude, coarse on
--                purpose: a byte count is close to unique for a given file
--   day          a date, never a timestamp. A time is a fingerprint on a quiet
--                day; a date is not.
--
-- ## What is deliberately absent
--
-- No IP address, hashed or otherwise. No user agent, no country, no referrer,
-- no session identifier, no duration, no engine name, no error text. Each of
-- those would answer a question somebody might one day want answered, and each
-- would turn an aggregate into a trail. `test/db/schema.test.ts` fails if any
-- of them appears, including in a second table or an index added later.

create table if not exists conversion_totals (
  pair text not null,
  outcome text not null,
  size_bucket text not null,
  day date not null,
  total bigint not null default 0,

  primary key (pair, outcome, size_bucket, day),

  constraint conversion_totals_outcome_known
    check (outcome in ('success', 'failure')),
  constraint conversion_totals_size_bucket_known
    check (size_bucket in ('xs', 's', 'm', 'l', 'xl')),
  -- The counter is only ever incremented, so a negative total means a bug
  -- somewhere above rather than a state worth representing.
  constraint conversion_totals_total_non_negative
    check (total >= 0)
);

-- GET /api/stats sums every successful row, all time, and counts the distinct
-- pairs among them — `readTotals` in lib/db/stats.ts. That is the only query
-- on a hot path; it filters on `outcome` and on nothing else, and the primary
-- key leads with `pair`, so the key is no help to it.
--
-- What this index buys is worth stating rather than overselling. `outcome` has
-- two values and `success` is the common one, so on a healthy table the planner
-- reads every row regardless and the index earns nothing but its write cost. It
-- starts earning on the only shape under which this query gets slow: a table
-- that has accumulated far more failures than successes, where the side being
-- summed is the small one. One index, for the one query. Adding another before
-- there is a second reader would be guessing.
--
-- The index this replaces was on `(day desc)`, written for a "recent days"
-- read that no query has ever performed. Dropping it first is what makes a
-- database provisioned before this change lose it on the next `pnpm db:migrate`
-- instead of carrying an index nothing will ever use. The drop is removable
-- once every environment has run `pnpm db:migrate` after issue #271; until
-- then it is the only way the old index stops existing anywhere.
drop index if exists conversion_totals_day_idx;

create index if not exists conversion_totals_outcome_idx
  on conversion_totals (outcome);

-- ## The second counter: how often each page was opened (issue #102)
--
-- The analytics, and all of them. A row means "this page was opened this many
-- times on this day", and it cannot mean anything narrower, because there is no
-- column for anything narrower.
--
-- ## Why this is not a hosted analytics product
--
-- Every one of them counts *visitors*, and counting visitors means telling two
-- of them apart. The usual mechanism is not a cookie any more — it is a daily
-- rotating hash of the address and the user agent, which is a pseudonymous
-- identifier however short its life. This file says, forty lines above, that it
-- holds no IP address hashed or otherwise. Adopting a product that computes one
-- somewhere else would make that sentence true about the database and false
-- about the system.
--
-- So the answer here is narrower and honest: page views, not visitors. Two
-- people opening a page and one person opening it twice are the same row, and
-- there is no way to ask which happened. That is a real limit — it means
-- "sessions", "bounce rate" and "returning visitors" are questions this schema
-- cannot answer, ever — and it is the point rather than a shortcoming.
--
-- What it does answer is the only question the 124 conversion pages were built
-- to raise: which of them anybody reaches. Search Console answers the same
-- question for visitors arriving from Google; this answers it for everybody.
--
--   page   one of the site's own route paths, checked against the same list
--          app/sitemap.ts publishes before the write (lib/db/parse-view.ts).
--          Free text in a `text` column is how a counter becomes a log.
--   day    a date, never a timestamp, for the reason given above.
create table if not exists page_totals (
  page text not null,
  day date not null,
  total bigint not null default 0,

  primary key (page, day),

  constraint page_totals_total_non_negative
    check (total >= 0)
);
