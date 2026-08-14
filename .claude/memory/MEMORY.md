# Docify Memory Index

Durable facts carried across sessions. One file per fact in `entries/`.
Search with the `docify-memory` skill; do not paste whole entries into context.

## constraint

- [monochrome-design-constraint](entries/monochrome-design-constraint.md) — The palette is monochrome by owner mandate — no blue/purple, no glassmorphism
- [no-ai-attribution-in-git](entries/no-ai-attribution-in-git.md) — Git history must carry no AI attribution — no Co-Authored-By, no bot contributors

## decision

- [coep-require-corp-scoped](entries/coep-require-corp-scoped.md) — COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only
- [no-server-side-processing](entries/no-server-side-processing.md) — All conversion runs client-side; there is deliberately no processing VM
- [router-gates-before-budget](entries/router-gates-before-budget.md) — The capability gate runs before the memory-budget check, so a rejection never quotes a doomed engine's ceiling
- [webcodecs-over-ffmpeg](entries/webcodecs-over-ffmpeg.md) — WebCodecs is the primary video path; ffmpeg.wasm is a last-resort fallback

## gotcha

- [libheif-is-primary-broken](entries/libheif-is-primary-broken.md) — libheif-js 1.19.8 ships a broken is_primary() that throws ReferenceError on every image
- [isolation-is-document-scoped](entries/isolation-is-document-scoped.md) — crossOriginIsolated is per-document, not per-device — it must never be cached alongside the rest of Capabilities

## process

- [parallel-agent-coordination](entries/parallel-agent-coordination.md) — Four hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order
- [pr-open-checklist](entries/pr-open-checklist.md) — Opening a PR is four steps, not one — code review, PR labels, issue status label, then the PR itself

## session

- [session-2026-08-13-5265dc09](entries/session-2026-08-13-5265dc09.md) — Session on 2026-08-13: agent, ui, engines, router (263 file ops)
- [session-2026-08-13-7f48e4c1](entries/session-2026-08-13-7f48e4c1.md) — Session on 2026-08-13: agent, router, engines, ci (91 file ops)
- [session-2026-08-13-9665567a](entries/session-2026-08-13-9665567a.md) — Session on 2026-08-13: agent, ui, engines (104 file ops)
- [session-2026-08-13-ed1231b5](entries/session-2026-08-13-ed1231b5.md) — Session on 2026-08-13: app, ci, agent (85 file ops)
