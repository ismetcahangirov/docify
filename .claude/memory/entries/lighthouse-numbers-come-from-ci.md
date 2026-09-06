---
name: "lighthouse-numbers-come-from-ci"
description: "A Lighthouse score measured on the dev laptop is not the gate's score — and lhci asserts the best run unless told otherwise"
type: "gotcha"
date: "2026-09-04"
---

Two independent traps, both found closing #237.

## The laptop is not the runner

Issue #237 recorded 0.94 on the home page with 240ms of TBT and concluded the
gap was structural — React hydrating a document with no interactive component,
which nothing in the repository could fix. The proposed remedies were inlining
the CSS by hand and shipping marketing pages with no client runtime, both real
changes to production.

Measured on the Linux CI runner the gate actually runs on: **0.98–0.99, TBT
64–71ms**. Nothing was changed to achieve that.

Those 0.94 numbers came from Windows, by hand, because `lhci autorun` cannot
complete there — chrome-launcher fails with `EPERM` deleting its own profile
(documented in `lighthouserc.cjs` since #238). Lighthouse's mobile emulation
applies a *fixed* 4x CPU multiplier, and a laptop already running a browser, a
dev server, an editor and a language server is not four times slower than an
idle runner in the way that multiplier assumes. The whole discrepancy landed on
TBT, the one metric that measures main-thread contention.

**Never file or close a performance issue on a locally measured Lighthouse
score.** To get the runner's numbers without an artifact, push a branch that
asserts impossible thresholds as `warn` — `lhci` prints the measured value and
all three runs for every assertion — then revert it in the same PR.

## lhci asserts the best run, not the median

`aggregationMethod` defaults to `optimistic`, which takes the **best** value
across `numberOfRuns`. The home page scored 0.97, 0.98 and 0.99; lhci reported
0.99. `lighthouserc.cjs` claimed median in a comment and was wrong for months.

That default is right for a dashboard and wrong for a gate: it hides a
regression for as long as any single run still passes. It is now set to
`median` explicitly.

The corollary is the threshold. The runner's own spread across three runs of one
URL was 0.02, so a gate set at the measured median fails on a busy afternoon
rather than on a regression. `categories:performance` is an error at 0.95
against a median of 0.98 — three points of headroom is what makes it assertable.

## The reports have never been uploaded

`.lighthouseci/` is a dot-directory and `actions/upload-artifact@v4` skips
hidden paths by default, so every run logs `No files were found` and stays green
on `if-no-files-found: warn`. Issue #250. Fixing it needs a `.github/workflows/`
edit, which the session token cannot push — `repo` scope without `workflow`.

Related: [[converter-is-a-deferred-island]], [[barrel-imports-cost-a-budget]]
