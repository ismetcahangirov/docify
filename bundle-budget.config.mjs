/**
 * First-load JavaScript budget, enforced by `pnpm size`.
 *
 * `maxFirstLoadJsBytes` is the gzipped weight of everything a route must
 * download before it can render — the shared runtime, every ancestor layout
 * chunk and the page chunk itself. It is measured per route, so the check
 * fails on the single heaviest page rather than on an average.
 *
 * The number comes from EPIC 9.1 of `docs/superpowers/plans/2026-08-13-docify.md`:
 * "Bundle budget (initial JS < 120 KB gzip)". kB here is 1000 bytes, matching
 * the "First Load JS" column that `next build` prints, so the budget and the
 * build output can be compared directly.
 *
 * Conversion engines never count against this budget: they are reached through
 * `dynamic import()` (CLAUDE.md §2.3) and so never appear in a route's
 * first-load set. If an engine ever does show up here, the budget failing is
 * the intended outcome — it means the lazy-loading invariant broke.
 */
const bundleBudget = {
  maxFirstLoadJsBytes: 120_000,
}

export default bundleBudget
