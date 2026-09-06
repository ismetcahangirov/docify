---
name: "sharp-is-denied-not-approved"
description: "sharp's build script is denied, and that decision has three sides — the deny, images.unoptimized, and the absence of next/image"
type: "decision"
date: "2026-09-04"
---

`pnpm-workspace.yaml` denies the `sharp` build script (`sharp: false`). It was
approved in #4/PR #107 only because pnpm 11 fails an install outright while a
dependency's build script is neither approved nor denied — the `allowBuilds`
file is necessary, the `true` on `sharp` was not. Issue #114 made the choice
explicit. **Denying is a decision**, which is all pnpm requires: the install
still exits 0.

## Why denied

`sharp` is Next's *server-side* image optimisation binding. It backs
`/_next/image` and nothing else. Docify has no server-side image pipeline, so
it was compiling a native libvips in all five CI jobs for a route it never
serves — and carrying a high-severity `pnpm audit --prod` finding
(GHSA-f88m-g3jw-g9cj, libvips CVEs, patched in `sharp ≥0.35.0`, which Next pins
us below) for the privilege. Vercel supplies its own `sharp` in production, so
approving the local build bought nothing there either.

`next/og` — which *does* render the Open Graph cards — is not affected. It
rasterises with satori and resvg-wasm and never loads `sharp`.

## The decision has three sides, and each can undo it alone

1. `sharp: false` in `pnpm-workspace.yaml`
2. `images: { unoptimized: true }` in `next.config.ts` — so a `next/image`
   added later fails visibly at build rather than at runtime on a deployment
3. No `next/image` import anywhere in `app/`, `components/` or `lib/`

`test/app/server-image-pipeline.test.ts` asserts all three. Flipping any one of
them on its own turns the unit job red, which is the point: the failure mode
this replaces was a silent `true` with a comment that did not engage with the
question.

## The audit noise is documented, not suppressed

`docs/ci/dependency-audit.md` triages all five `pnpm audit --prod` findings —
the `sharp` one and the four `postcss@8.4.31` `sourceMappingURL` advisories that
Next pins transitively. `sharp` will keep appearing there until Next pins
`≥0.35.0`, because the audit reads the lockfile rather than the build. Do not
add a `pnpm.overrides` entry to silence it: an override on a transitive native
binding is a lie the next reader has to unpick.

If Docify ever needs `next/image`, reopen #114 rather than flipping the flag —
approving `sharp` again has a security cost and belongs in an issue.

Related: [[no-server-side-processing]], [[barrel-imports-cost-a-budget]]
