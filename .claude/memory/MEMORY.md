# Docify Memory Index

Durable facts carried across sessions. One file per fact in `entries/`.
Search with the `docify-memory` skill; do not paste whole entries into context.

## constraint

- [monochrome-design-constraint](entries/monochrome-design-constraint.md) — The palette is monochrome by owner mandate — no blue/purple, no glassmorphism
- [no-ai-attribution-in-git](entries/no-ai-attribution-in-git.md) — Git history must carry no AI attribution — no Co-Authored-By, no bot contributors

## decision

- [budget-is-affine-and-scoped](entries/budget-is-affine-and-scoped.md) — The memory budget is factor x heldBytes + reserveBytes, and each engine says whether it holds every file of a job at once or one at a time
- [pdfjs-runs-workerless-and-legacy](entries/pdfjs-runs-workerless-and-legacy.md) — pdf.js runs inside our worker only without its own worker and only as the legacy build — both are deliberate, not workarounds
- [coep-require-corp-scoped](entries/coep-require-corp-scoped.md) — COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only
- [no-server-side-processing](entries/no-server-side-processing.md) — All conversion runs client-side; there is deliberately no processing VM
- [router-gates-before-budget](entries/router-gates-before-budget.md) — The capability gate runs before the memory-budget check, so a rejection never quotes a doomed engine's ceiling
- [webcodecs-over-ffmpeg](entries/webcodecs-over-ffmpeg.md) — WebCodecs is the primary video path; ffmpeg.wasm is a last-resort fallback

## gotcha

- [cancel-needs-a-macrotask-yield](entries/cancel-needs-a-macrotask-yield.md) — An engine loop that only awaits promises never observes a cancel — the worker's message loop needs a macrotask to run
- [libheif-is-primary-broken](entries/libheif-is-primary-broken.md) — libheif-js 1.19.8 ships a broken is_primary() that throws ReferenceError on every image
- [isolation-is-document-scoped](entries/isolation-is-document-scoped.md) — crossOriginIsolated is per-document, not per-device — it must never be cached alongside the rest of Capabilities

## process

- [parallel-agent-coordination](entries/parallel-agent-coordination.md) — Hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order, and scaffolding the shared surface first
- [pr-open-checklist](entries/pr-open-checklist.md) — Opening a PR is four steps, not one — code review, PR labels, issue status label, then the PR itself

## session

- [session-2026-08-14-3d8eb6eb](entries/session-2026-08-14-3d8eb6eb.md) — Session on 2026-08-14: engines, agent (47 file ops)
- [session-2026-08-13-5265dc09](entries/session-2026-08-13-5265dc09.md) — Session on 2026-08-13: agent, ui, engines, router (263 file ops)
- [session-2026-08-13-7f48e4c1](entries/session-2026-08-13-7f48e4c1.md) — Session on 2026-08-13: agent, router, engines, ci (91 file ops)
- [session-2026-08-13-9665567a](entries/session-2026-08-13-9665567a.md) — Session on 2026-08-13: agent, ui, engines (104 file ops)
- [session-2026-08-13-ed1231b5](entries/session-2026-08-13-ed1231b5.md) — Session on 2026-08-13: app, ci, agent (85 file ops)
