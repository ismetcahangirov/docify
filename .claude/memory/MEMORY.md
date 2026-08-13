# Docify Memory Index

Durable facts carried across sessions. One file per fact in `entries/`.
Search with the `docify-memory` skill; do not paste whole entries into context.

## constraint

- [monochrome-design-constraint](entries/monochrome-design-constraint.md) — The palette is monochrome by owner mandate — no blue/purple, no glassmorphism
- [no-ai-attribution-in-git](entries/no-ai-attribution-in-git.md) — Git history must carry no AI attribution — no Co-Authored-By, no bot contributors

## decision

- [coep-require-corp-scoped](entries/coep-require-corp-scoped.md) — COEP is require-corp (not credentialless) and is scoped to /convert/* and /tools/* only
- [no-server-side-processing](entries/no-server-side-processing.md) — All conversion runs client-side; there is deliberately no processing VM
- [webcodecs-over-ffmpeg](entries/webcodecs-over-ffmpeg.md) — WebCodecs is the primary video path; ffmpeg.wasm is a last-resort fallback

## process

- [parallel-agent-coordination](entries/parallel-agent-coordination.md) — Four hazards when several agents work one repo at once — shared scratchpad, stale conditional rules, lockfile conflicts, merge order
- [pr-open-checklist](entries/pr-open-checklist.md) — Opening a PR is four steps, not one — code review, PR labels, issue status label, then the PR itself
