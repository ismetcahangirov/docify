#!/usr/bin/env node
/*
 * TEMPORARY stand-in for the unit and end-to-end test runners.
 *
 * CI already calls `pnpm test` and `pnpm e2e`, so both scripts have to exist
 * and exit 0 before the real harnesses land:
 *
 *   unit  ->  Vitest + Testing Library, issue #5
 *   e2e   ->  Playwright, issue #6
 *
 * Delete this file — and repoint the `test`, `test:watch` and `e2e` scripts in
 * package.json — as part of those issues. Extra CLI arguments (CI passes
 * `--run --coverage`) are accepted and ignored on purpose.
 */

const NOTICES = {
  unit: 'unit tests are not wired up yet — Vitest arrives in issue #5',
  e2e: 'end-to-end tests are not wired up yet — Playwright arrives in issue #6',
}

const suite = process.argv[2]
const notice = NOTICES[suite]

if (!notice) {
  console.error(`[docify] ci-stub: unknown suite "${suite ?? ''}". Expected: unit | e2e.`)
  process.exit(1)
}

console.log(`[docify] ${notice}`)
process.exit(0)
