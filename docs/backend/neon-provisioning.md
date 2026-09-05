# Provisioning the Neon database

The runbook behind issue #101. It is short because the schema is short: two
tables of anonymous counters, described in full — including what they
deliberately omit — at the top of [`lib/db/schema.sql`](../../lib/db/schema.sql).

## What the database is for, and what happens without it

`POST /api/stats` increments a counter after a conversion finishes, and
`POST /api/views` does the same for a page that was opened. `GET /api/stats`
reads the all-time totals back out — every successful conversion summed, and
the number of distinct pairs among them. That is the entire server-side data
model.

Nothing in the product depends on it. `lib/db/neon.ts` returns `null` when
`DATABASE_URL` is unset or malformed, every caller treats that as "skip the
counter and carry on", and `test/app/backend-degradation.test.ts` is what keeps
it that way. So a build with no database is a supported configuration rather
than a broken one — which is why the steps below are a deploy-time task and not
a prerequisite for running the app.

## Create the project

1. In the [Neon console](https://console.neon.tech), create a project.
   - **Region:** the one closest to the region the app is deployed in. Both
     ends of a counter write should be on the same continent; nothing here is
     latency-sensitive enough to justify more thought than that.
   - **Postgres version:** the current default. Nothing in the schema is
     version-specific.
   - **Database name:** `docify`.
2. Neon creates a `production` branch. Leave it as the only branch until there
   is a second consumer; a preview deployment writing into the same counters is
   the correct behaviour, since a row is a group and never a person.

## Apply the schema

Copy the **pooled** connection string from the project dashboard — the one whose
host contains `-pooler`. The application talks to Neon over HTTP through
`@neondatabase/serverless`, and the pooled endpoint is what that path expects.

```bash
export DATABASE_URL="postgresql://...@ep-....-pooler.<region>.aws.neon.tech/docify?sslmode=require"
pnpm db:migrate
```

`pnpm db:migrate` sends each statement in `lib/db/schema.sql` and then reports
what the database holds. Every statement is idempotent — `if not exists` on what
the schema creates, `if exists` on what it drops — so running it again after a
schema change, or twice by accident, is a no-op rather than an error.

It also checks the report against the schema it just sent: a table the file
declares and the database lacks is a failure that names it, and a table the
database holds that the file never declares is a note. Both lists are derived
from `lib/db/schema.sql` itself, so neither goes stale when the schema grows.

To read the current state without writing anything:

```bash
pnpm db:migrate --check
```

Expected output on a provisioned database:

```
  tables   conversion_totals, page_totals
  indexes  conversion_totals_outcome_idx, conversion_totals_pkey, page_totals_pkey
Schema is applied.
```

## Store the connection string

The same string goes into two places, and nowhere else:

| Where                                 | How                                                                                    |
| ------------------------------------- | -------------------------------------------------------------------------------------- |
| Vercel (Production, Preview)          | `vercel env add DATABASE_URL production` — or the project's Environment Variables page |
| Your shell, when running `db:migrate` | An export, or a local `.env` file, which `.gitignore` keeps out of the history         |

`.env.example` lists the variable without a value. It is the file to update when
a new one is introduced; a variable that exists only in a dashboard is a
variable the next deploy forgets.

Do not put the string in `NEXT_PUBLIC_*`. It would be inlined into the client
bundle, which is the one place a database credential must never be.

## Rotating it

Neon resets a role's password from **Roles → Reset password**. The application
caches its client keyed on the connection string rather than on a boolean
(`lib/db/neon.ts`), so a rotated secret is picked up on the next request that
sees the new value — updating the Vercel variable and redeploying is enough,
and there is no separate cache to clear.

## What is deliberately not here

- **No migration framework.** Two tables of counters, every statement
  idempotent. A versions table would be more moving parts than the thing it
  tracks.
- **No seed data.** A counter starts at zero by construction; there is nothing
  to seed.
- **No backup policy beyond Neon's own.** The data is aggregate counts that the
  product does not read at runtime. Losing it costs a chart, not a user's work.
