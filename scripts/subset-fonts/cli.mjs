#!/usr/bin/env node
/**
 * `pnpm subset:fonts` — cut each vendored family into the half the pages render
 * and the half they do not (issue #315).
 *
 * ## Why this exists
 *
 * Lighthouse's LCP is a simulation, and the graph it simulates is every
 * resource the browser had finished fetching before the first paint. On `/`
 * that set was 235kB, and 105kB of it was three preloaded woff2 files carrying
 * Google's whole `latin` subset — 230 codepoints, of which the 260 prerendered
 * documents render 82. The other 148 were on the critical path of every page
 * view on the chance that somebody's file name contains an ï.
 *
 * The split keeps all 230. The core half is preloaded; the extended half is a
 * second `@font-face` of the same family with no `unicode-range` of its own,
 * which the browser fetches only when a character needs it. Nothing renders in
 * a different face than it did before — the bytes simply arrive later when they
 * arrive at all.
 *
 * ## Why the output is committed
 *
 * The same reason the sources are: a build must not depend on a subsetter
 * running, and `app/fonts.ts` hashes and preloads whatever files are on disk.
 * This is a vendoring step run by hand when a source font changes, not part of
 * `pnpm vendor` — which regenerates gitignored engine binaries on every build.
 *
 * ## Reproducing
 *
 *     pnpm subset:fonts
 *
 * It reads `assets/fonts/`, writes `public/fonts/`, and prints what each file
 * cost. Re-run it after replacing a source font, and commit the six results.
 */

import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import subsetFont from 'subset-font'

import { FAMILIES, OUTPUT_DIR, SOURCE_DIR } from './families.mjs'
import { CORE, EXTENDED, textOf } from './ranges.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../..')

/** Kilobytes, to one decimal, for the report. */
function kb(bytes) {
  return `${(bytes / 1024).toFixed(1)}kB`
}

/**
 * Cut one half out of one source file.
 *
 * `keepFeatures` is the whole reason this goes through harfbuzz rather than a
 * character list alone: the subsetter's glyph closure follows every layout
 * lookup it keeps, so a face's ligature table drags its ligature glyphs into
 * the output even when nothing maps to them.
 *
 * @param {Buffer} source
 * @param {string} text characters to keep
 * @param {readonly string[]} features OpenType feature tags to retain
 * @returns {Promise<Buffer>}
 */
async function cut(source, text, features) {
  return subsetFont(source, text, {
    targetFormat: 'woff2',
    keepFeatures: [...features],
  })
}

async function main() {
  const coreText = textOf(CORE)
  const extendedText = textOf(EXTENDED)

  for (const family of FAMILIES) {
    const source = await readFile(join(repoRoot, SOURCE_DIR, family.source))

    const core = await cut(source, coreText, family.features)
    const extended = await cut(source, extendedText, family.features)

    await writeFile(join(repoRoot, OUTPUT_DIR, family.core), core)
    await writeFile(join(repoRoot, OUTPUT_DIR, family.extended), extended)

    console.log(
      `${family.source}: ${kb(source.length)} → ${kb(core.length)} core (preloaded) + ` +
        `${kb(extended.length)} extended (on demand)`,
    )
  }
}

await main()
