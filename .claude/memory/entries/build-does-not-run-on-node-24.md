---
name: build-does-not-run-on-node-24
description: pnpm build crashes on Node 24 with a webpack WasmHash error — package.json's ">=22" says otherwise, and lint/typecheck/test pass regardless
type: gotcha
date: 2026-09-04
---

`pnpm build` fails on Node **v24.19.0**, on clean `main`, before it emits a
single route:

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

Build on Node 22. If that is not available, say so in the PR rather than
implying `pnpm e2e` was run — CI is then the only evidence, and it is the job
that catches this class of bug.

Do not conclude a build failure is your change until it has been reproduced with
the tree stashed. `git stash -u && pnpm build` costs three minutes and answers
it.

Related: [[lighthouse-numbers-come-from-ci]], [[ci-does-not-run-on-a-conflicting-pr]]
