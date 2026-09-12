---
name: "backend-outage-and-misconfiguration-are-the-same-answer"
description: "A wrong DATABASE_URL and no DATABASE_URL produce the identical {\"available\":false}, and readTotals swallows the difference"
type: "gotcha"
date: "2026-09-12"
---

`GET /api/stats` answers `{"available":false}` in two unrelated situations, and nothing distinguishes them from outside:

- `connection()` returned `null` — no `DATABASE_URL` at all, which is a supported configuration.
- `readTotals()` threw and its `catch { return null }` absorbed it — a malformed connection string, an unreachable host, a missing table.

Both are deliberate. `lib/db/neon.ts` returns `null` rather than throwing so a build with no database is supported, and the route answers 200 rather than 500 so a homepage never fails because a counter is unreachable. Neither decision is wrong. Together they mean a **misconfigured** deployment is indistinguishable from an **unconfigured** one, and there is no log line either, because the throw never leaves the `catch`.

This cost two production redeploys on 2026-09-12. The value pasted into the Vercel dashboard was malformed; the same string, added through `vercel env add` from a shell where it had already been proven against Neon, worked on the first try.

**How to tell them apart without guessing:**

1. Prove the string itself from a shell — `pnpm db:migrate --check` connects and reports, so a working string is a fact rather than an assumption.
2. Then `curl -sI` the route and read `x-vercel-cache`. A `MISS` with `age: 0` means the function actually ran and genuinely has no database; a `HIT` means the answer predates whatever was just changed. The unavailable answer is cached for only 10 seconds (`UNAVAILABLE_SECONDS`) precisely so this window is short.
3. Only then suspect the deployment.

A real change of the value needs a redeploy to be visible, whatever the "read at" column in `docs/deploy/vercel.md` says about request time — that column describes when the *code* reads the variable, not when Vercel hands a new one to a running deployment.

Related: [[deployment-runs-on-three-free-tiers]]
