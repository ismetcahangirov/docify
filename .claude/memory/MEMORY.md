# Docify Memory Index

Durable facts carried across sessions. One file per fact in `entries/`.
Search with the `docify-memory` skill; do not paste whole entries into context.

## constraint

- [monochrome-design-constraint](entries/monochrome-design-constraint.md) — The palette is monochrome by owner mandate — no blue/purple, no glassmorphism
- [no-ai-attribution-in-git](entries/no-ai-attribution-in-git.md) — Git history must carry no AI attribution — no Co-Authored-By, no bot contributors

## decision

- [a-copy-refuses-what-the-target-cannot-hold](entries/a-copy-refuses-what-the-target-cannot-hold.md) — The codec check for a stream copy lives in the engine, not the router — the router has a format pair and a size and cannot see inside the file
- [settings-only-where-an-engine-reads-them](entries/settings-only-where-an-engine-reads-them.md) — A tool page offers a control only when an engine on that path reads it, which is why the panel is chosen by source and target together rather than by the target's family
- [analytics-count-views-never-visitors](entries/analytics-count-views-never-visitors.md) — The analytics deliberately cannot count visitors — every hosted product identifies one, and the schema says Docify holds no address hashed or otherwise
- [sharp-is-denied-not-approved](entries/sharp-is-denied-not-approved.md) — sharp's build script is denied, and that decision has three sides — the deny, images.unoptimized, and the absence of next/image
- [converter-is-a-deferred-island](entries/converter-is-a-deferred-island.md) — The converter loads after the static page, its skeleton is sized to prevent shift, and its scheduler must be an effect
- [stream-copy-outranks-both-codecs](entries/stream-copy-outranks-both-codecs.md) — A stream copy is its own engine at priority 12, ahead of WebCodecs and ffmpeg — and the webcodecs budget it is compared against is not trustworthy
- [budget-is-affine-and-scoped](entries/budget-is-affine-and-scoped.md) — The memory budget is factor x heldBytes + reserveBytes, and each engine says whether it holds every file of a job at once or one at a time
- [pdfjs-runs-workerless-and-legacy](entries/pdfjs-runs-workerless-and-legacy.md) — pdf.js runs inside our worker only without its own worker and only as the legacy build — both are deliberate, not workarounds
- [raster-ceilings-are-two-and-scoped](entries/raster-ceilings-are-two-and-scoped.md) — The raster pixel guard is two different ceilings over three engines — vips is deliberately exempt and canvas/heif deliberately get the browser limit, not the budget one
- [coep-require-corp-scoped](entries/coep-require-corp-scoped.md) — COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only
- [no-server-side-processing](entries/no-server-side-processing.md) — All conversion runs client-side; there is deliberately no processing VM
- [router-gates-before-budget](entries/router-gates-before-budget.md) — The capability gate runs before the memory-budget check, so a rejection never quotes a doomed engine's ceiling
- [webcodecs-over-ffmpeg](entries/webcodecs-over-ffmpeg.md) — WebCodecs is the primary video path; ffmpeg.wasm is a last-resort fallback

## gotcha

- [a-carried-track-is-a-term-of-the-size-target](entries/a-carried-track-is-a-term-of-the-size-target.md) — An engine that copies a track past the encoder owes that track's bitrate to the size target, or the capable browser is the one that overshoots
- [build-does-not-run-on-node-24](entries/build-does-not-run-on-node-24.md) — pnpm build crashes on the Windows dev machine with a webpack WasmHash error on Node 22 and 24 alike — CI on Linux builds the same tree, and lint/typecheck/test pass regardless
- [a-pixel-bound-test-needs-a-device-without-simd](entries/a-pixel-bound-test-needs-a-device-without-simd.md) — A test that means to exercise the decoded-pixel bound must route on a device with wasmSimd false, or vips answers and the assertion proves nothing
- [lighthouse-numbers-come-from-ci](entries/lighthouse-numbers-come-from-ci.md) — A Lighthouse score measured on the dev laptop is not the gate's score — and lhci asserts the best run unless told otherwise
- [barrel-imports-cost-a-budget](entries/barrel-imports-cost-a-budget.md) — A single umbrella import cost 76 kB gzipped on every route — pnpm size names the route, never the package
- [ci-does-not-run-on-a-conflicting-pr](entries/ci-does-not-run-on-a-conflicting-pr.md) — A PR with no checks at all is usually a merge conflict, not a stuck runner — GitHub never starts CI on one
- [abort-is-matched-by-name](entries/abort-is-matched-by-name.md) — An abort is identified by name === 'AbortError', never by instanceof — Comlink drops DOMException and jsdom does not make it an Error
- [cancel-needs-a-macrotask-yield](entries/cancel-needs-a-macrotask-yield.md) — An engine loop that only awaits promises never observes a cancel — the worker's message loop needs a macrotask to run
- [libheif-is-primary-broken](entries/libheif-is-primary-broken.md) — libheif-js 1.19.8 ships a broken is_primary() that throws ReferenceError on every image
- [isolation-is-document-scoped](entries/isolation-is-document-scoped.md) — crossOriginIsolated is per-document, not per-device — it must never be cached alongside the rest of Capabilities

## process

- [parallel-agent-coordination](entries/parallel-agent-coordination.md) — Hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order, scaffolding the shared surface first, the comments a rename leaves behind, resuming interrupted agents, and verifying the merged tree
- [pr-open-checklist](entries/pr-open-checklist.md) — Opening a PR is four steps, not one — code review, PR labels, issue status label, then the PR itself

## session

- [session-2026-09-05-2f87c69e](entries/session-2026-09-05-2f87c69e.md) — Session on 2026-09-05: general work (0 file ops)
- [session-2026-09-05-417bea57](entries/session-2026-09-05-417bea57.md) — Session on 2026-09-05: ui, agent (12 file ops)
- [session-2026-09-05-b12ee5ec](entries/session-2026-09-05-b12ee5ec.md) — Session on 2026-09-05: engines, registry, agent (27 file ops)
- [session-2026-09-05-d9950ae1](entries/session-2026-09-05-d9950ae1.md) — Session on 2026-09-05: general work (0 file ops)
- [session-2026-09-05-dfd52f3f](entries/session-2026-09-05-dfd52f3f.md) — Session on 2026-09-05: ui, engines, agent, app, registry (90 file ops)
- [session-2026-09-04-b5e1f97e](entries/session-2026-09-04-b5e1f97e.md) — Session on 2026-09-04: app, seo, backend, ui, agent (42 file ops)
- [session-2026-09-03-c0a3c505](entries/session-2026-09-03-c0a3c505.md) — Session on 2026-09-03: app, seo (29 file ops)
- [session-2026-09-02-a06d931f](entries/session-2026-09-02-a06d931f.md) — Session on 2026-09-02: ui, router, registry, seo, app (79 file ops)
- [session-2026-09-01-e2537969](entries/session-2026-09-01-e2537969.md) — Session on 2026-09-01: engines, ui (46 file ops)
- [session-2026-08-31-6c17ae3e](entries/session-2026-08-31-6c17ae3e.md) — Session on 2026-08-31: engines (107 file ops)
- [session-2026-08-31-93a6a515](entries/session-2026-08-31-93a6a515.md) — Session on 2026-08-31: agent (4 file ops)
- [session-2026-08-14-12f2e378](entries/session-2026-08-14-12f2e378.md) — Session on 2026-08-14: agent, engines, router (125 file ops)
- [session-2026-08-14-3d8eb6eb](entries/session-2026-08-14-3d8eb6eb.md) — Session on 2026-08-14: engines, agent (47 file ops)
- [session-2026-08-14-4d6b83f8](entries/session-2026-08-14-4d6b83f8.md) — Session on 2026-08-14: engines, agent (158 file ops)
- [session-2026-08-14-ce23b202](entries/session-2026-08-14-ce23b202.md) — Session on 2026-08-14: agent, engines, router (110 file ops)
- [session-2026-08-13-5265dc09](entries/session-2026-08-13-5265dc09.md) — Session on 2026-08-13: agent, ui, engines, router (263 file ops)
- [session-2026-08-13-7f48e4c1](entries/session-2026-08-13-7f48e4c1.md) — Session on 2026-08-13: agent, router, engines, ci (91 file ops)
- [session-2026-08-13-9665567a](entries/session-2026-08-13-9665567a.md) — Session on 2026-08-13: agent, ui, engines (104 file ops)
- [session-2026-08-13-ed1231b5](entries/session-2026-08-13-ed1231b5.md) — Session on 2026-08-13: app, ci, agent (85 file ops)
