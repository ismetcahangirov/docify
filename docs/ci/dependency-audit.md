# Dependency audit triage

`pnpm audit --prod` is not clean on `main`, and it will not become clean by
bumping anything Docify declares. Every finding below is inside `next`'s own
pinned dependency range. This page is the triage, written once so the same five
advisories are not re-investigated in every security pass.

Re-run it with:

```bash
pnpm audit --prod --json
```

Last triaged: 2026-09-04, against `next@15.5.23`.

---

## What the audit reports

| Advisory                                                                           | Package                 | Severity | Fixed in  | Reachable here |
| ---------------------------------------------------------------------------------- | ----------------------- | -------- | --------- | -------------- |
| [GHSA-f88m-g3jw-g9cj](https://github.com/advisories/GHSA-f88m-g3jw-g9cj) (libvips) | `next > sharp@0.34.5`   | high     | `≥0.35.0` | **No**         |
| [GHSA-6g55-p6wh-862q](https://github.com/advisories/GHSA-6g55-p6wh-862q)           | `next > postcss@8.4.31` | high     | `≥8.5.12` | Build only     |
| [GHSA-r28c-9q8g-f849](https://github.com/advisories/GHSA-r28c-9q8g-f849)           | `next > postcss@8.4.31` | high     | `≥8.5.18` | Build only     |
| [GHSA-qx2v-qp2m-jg93](https://github.com/advisories/GHSA-qx2v-qp2m-jg93)           | `next > postcss@8.4.31` | moderate | `≥8.5.10` | Build only     |
| [GHSA-fxqj-rqcc-2cmp](https://github.com/advisories/GHSA-fxqj-rqcc-2cmp)           | `next > postcss@8.4.31` | moderate | `≥8.5.23` | Build only     |

---

## `sharp` — not reachable, and no longer built

`sharp` is Next's server-side image optimisation binding: it backs `/_next/image`
and nothing else. Docify has no server-side image pipeline (CLAUDE.md §2.1), and
in particular:

- nothing in `app/`, `components/` or `lib/` imports `next/image`;
- the two Open Graph routes use `next/og`, which rasterises with satori and
  resvg-wasm and never loads sharp;
- `next.config.ts` sets `images: { unoptimized: true }`, so the optimiser route
  is not served at all.

`sharp` is also an _optional_ dependency of `next` — `pnpm audit --json` reports
the finding with `"optional": true`. Since #114 its build script is denied in
`pnpm-workspace.yaml`, so the native libvips build no longer runs in any of the
five CI jobs and the vulnerable code is never compiled, let alone called.

The advisory will keep appearing in `pnpm audit --prod` until Next pins
`sharp@≥0.35.0`, because the audit reads the lockfile rather than the build.
That is noise, not exposure. Do not add an override to silence it: an override
on a transitive native binding is a lie the next reader has to unpick, and the
honest record is this page.

`test/app/server-image-pipeline.test.ts` fails if the deny, the `unoptimized`
flag, or the absence of `next/image` is undone on its own.

## `postcss` — build-time only

All four `postcss` advisories are path-traversal or XSS via an attacker-controlled
`sourceMappingURL` inside a CSS comment. Reaching any of them requires PostCSS to
process CSS an attacker wrote.

The only CSS PostCSS sees in this repository is `app/globals.css` and what
Tailwind generates from the class names in the tree — all of it checked in, none
of it user-supplied, and none of it processed at runtime. Docify runs no PostCSS
on a server: `postcss` is a build-time dependency of `next` and does not ship in
any client bundle.

`next` pins the version transitively, so the resolution is to take it when Next
takes it. Re-check on every Next upgrade and refresh the table above.

---

## When to change this page

- On a `next` upgrade: re-run the audit and update the version column.
- On a new advisory: add a row, and say whether it is reachable and why.
- If Docify ever needs `next/image`: #114 is reopened, not worked around —
  approving `sharp` again is a decision with a security cost and belongs in an
  issue, not in a lockfile change.
