---
name: "build-does-not-run-on-node-24"
description: "pnpm build crashes on the Windows dev machine with a webpack WasmHash error on Node 22 and 24 alike — CI on Linux builds the same tree, and lint/typecheck/test pass regardless"
type: "gotcha"
date: "2026-09-04"
---

`pnpm build` fails on the Windows development machine, on clean `main`, before
it emits a single route. First seen on Node **v24.19.0** and blamed on the
version; on 2026-09-05 it was reproduced on Node **v22.23.2** (installed with
`pnpm env use --global 22`) with the identical stack, while CI built the same
tree on Linux with Node 22 the same day. So it is the platform, not the major
version. Node 20 does not help either: pnpm 11 itself needs `node:sqlite`,
which 20 does not have.

```
TypeError: Cannot read properties of undefined (reading 'length')
    at WasmHash._updateWithBuffer (next/dist/compiled/webpack/bundle5.js:...)
    at BatchedHash.update
Next.js build worker exited with code: 1 and signal: null
```

Webpack 5 hashes modules with a WebAssembly xxhash64 implementation and reuses
one instance across calls; under Node 24 that instance's memory buffer is
detached between calls. It is a bundler-and-runtime interaction, not anything in
this repository — reproduced with the working tree stashed.

## Why it is easy to lose an hour to

`package.json` declares `"node": ">=22"`, which says v24 is fine. CI pins
`NODE_VERSION: '22'` and is green, so the declaration and the only environment
that proves anything have diverged with nothing to say so. Tracked as issue
#260.

Worse, the three fastest gates are unaffected: `pnpm lint`, `pnpm typecheck` and
`pnpm test` all pass on Node 24. What breaks is everything that needs a build:

| Command           | On Node 24                                                  |
| ----------------- | ------------------------------------------------------------ |
| `pnpm build`      | crashes                                                      |
| `pnpm size`       | reads what the build wrote — nothing to read                 |
| `pnpm audit:seo`  | same                                                         |
| `pnpm e2e`        | Playwright's `webServer` runs `pnpm build && pnpm start` first |
| `pnpm lighthouse` | builds first, and is already unusable on Windows anyway       |

So a session can run every check it thinks matters, push, and be told by CI
about a class of failure it had no way to see. That is exactly what happened
closing #102: the analytics beacon broke an e2e assertion that could not be run
locally, and the regression reached `main`.

## What to do about it

There is no local build on this machine, on any Node. Say so in the PR rather
than implying `pnpm size`, `pnpm audit:seo` or `pnpm e2e` was run — CI is then
the only evidence, and it is the job that catches this class of bug. Do not
spend the hour trying another Node version: 20, 22 and 24 have all been tried.

`next dev` *does* run here. So the checks that only need a served page — axe
against a route, the responsive sweep, a Playwright spec pointed at
`localhost:3000` — can still be driven by hand against the dev server, and on
#267 that would have caught both CI failures (a contrast check axe could not
evaluate, and a link the SEO audit called broken) before the push.

`pnpm env use --global <version>` is the way to try one anyway. Two traps:
pnpm's bin directory must be on `PATH` for the command to run at all, and it
must be *appended*, not prefixed — prefixed, its `node` shim shadows the system
Node for pnpm itself, and every pnpm command then prints a bare version string
and exits.

Do not conclude a build failure is your change until it has been reproduced with
the tree stashed. `git stash -u && pnpm build` costs three minutes and answers
it.

Related: [[lighthouse-numbers-come-from-ci]], [[ci-does-not-run-on-a-conflicting-pr]]
