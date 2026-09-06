---
name: "converter-is-a-deferred-island"
description: "The converter loads after the static page, its skeleton is sized to prevent shift, and its scheduler must be an effect"
type: "decision"
date: "2026-09-02"
---

A conversion page is static HTML plus exactly one hydrating component, and that
component is loaded *after* the markup rather than in front of it.

`app/convert/[pair]/page.tsx` renders the heading, introduction, steps, note,
questions, breadcrumb, related links and JSON-LD on the server at build time.
`components/converter/converter-island.tsx` is a `next/dynamic` boundary with
`ssr: false` around `./converter`.

## Why deferring it is not a way to move a number

The island is 36 kB gzipped — the whole difference between 104 kB and 139 kB
against the 120 kB budget. It would be gaming the metric if the user paid for
it, and they do not: the converter cannot do anything until somebody drops a
file on it, which is seconds after first paint at the very best, while the
static content is what a reader sees and what a crawler reads. Loading it in
parallel rather than in front is strictly better for both.

`ssr: false` because the component renders an empty queue on the server and
throws it away, and `probeCapabilities()` cannot run there in any case.

## The skeleton is load-bearing

`ConverterSkeleton` reproduces the dropzone's `min-h-52`, its `p-8 sm:p-12`
padding and its border. Without it the island arrives into a zero-height box and
pushes every section below it down — the layout shift EPIC 9 sets a budget for,
introduced by a performance optimisation. `test/components/converter/converter-island.test.tsx`
pins those three utilities against the real component's.

## The scheduler has to be an effect

The obvious wiring is `const added = add(files); for (const job of added) await run(job.id, task)`
and it does **nothing at all**. `add` dispatches; `useFileQueue`'s `latest` ref is
assigned during render, so the job does not exist in the queue `run` can see
until that dispatch has committed. `run` finds no job and returns early, and
every file sits at "Waiting" for ever — with no error anywhere.

So `Converter` starts jobs from a `useEffect` over `queue.jobs`, picking one
`queued` job that is not already in a `started` ref. One at a time, which is also
what `lib/router/budget.ts` assumes: each engine's ceiling is calculated for a
tab it has to itself, so two large jobs at once turns a correct routing decision
into an out-of-memory crash.

A cancelled job stays in `started`, so it waits for the user to press retry
rather than restarting itself the moment they stop it.

## Revisit triggers

- Anything else on a converter page becomes interactive. It belongs inside the
  island or behind its own boundary; adding it to the page directly puts it in
  the first load.
- The queue gains real concurrency. The `busy` ref is the only thing enforcing
  one-at-a-time, and it is deliberately not a queue depth setting.

Related: [[budget-is-affine-and-scoped]], [[coep-require-corp-scoped]]
