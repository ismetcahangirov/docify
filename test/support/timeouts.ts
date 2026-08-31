/**
 * How long a suite that opens a real document is allowed to take.
 *
 * Vitest's default is 5000 ms, which was chosen for tests that assert on pure
 * functions. Several suites here do not: they generate a PDF with pdf-lib,
 * parse it back, and in `pdf-render` run pdf.js over it — real work on real
 * bytes, which is the point of those tests.
 *
 * ## Where the number comes from
 *
 * A full `vitest run` on an idle 16-core machine, worst single test per file:
 *
 * | suite                      | slowest test |
 * | -------------------------- | ------------ |
 * | `pdf-render.test.ts`       |      5 424 ms |
 * | `pdf-merge.test.ts`        |      2 348 ms |
 * | `pdflib.test.ts`           |      2 277 ms |
 * | `pdf-from-images.test.ts`  |      1 184 ms |
 * | `pdfjs-assets.test.ts`     |      1 058 ms |
 *
 * The slowest already exceeds the default while idle. #179 measured the same
 * test at 11–13 s when the machine is running other work — an inflation of
 * roughly 2.4×, which is what a fork pool sharing sixteen cores with a build
 * costs. 30 s is a little over twice that loaded worst case: enough that a
 * loaded run is not a coin toss, and short enough that a test which has
 * genuinely hung still reports inside half a minute rather than holding CI.
 *
 * ## Which suites get it
 *
 * The five above — the ones whose slowest test leaves less than 5× headroom
 * under the default. The remaining PDF suites (`pdf-open`, `pdf-split`,
 * `pdf-organize`) peak at 184 ms and are two orders of magnitude clear; raising
 * their ceiling would buy nothing and would hide it if one of them grew teeth.
 */
export const PDF_SUITE_TIMEOUT_MS = 30_000
