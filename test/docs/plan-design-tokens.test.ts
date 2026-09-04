import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * The plan is a specification, and a specification that has drifted from the
 * code is worse than none: the next agent to read it either reintroduces what
 * it says or renames the code to match. Issue #120 is exactly that failure —
 * the plan's font block still carried the pre-#13 stack form, in which the
 * generic sits *outside* `var()`, plus a `--font-jetbrains` that #13 and #14
 * had already coordinated onto `--font-jetbrains-mono`.
 *
 * So the plan's font declarations are asserted against the ones that shipped,
 * character for character. `test/app/globals-tokens.test.ts` pins the shipped
 * side to its documented value; this file pins the document to the shipped
 * side. Together the two make the drift impossible rather than merely fixed.
 *
 * Only the font stacks are guarded. The plan's colour and radius blocks are
 * lowercase where `globals.css` is not, and normalising for that would make
 * this test lenient about exactly the kind of difference it exists to catch.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const globalsCss = readFileSync(join(repoRoot, 'app', 'globals.css'), 'utf8')
const plan = readFileSync(
  join(repoRoot, 'docs', 'superpowers', 'plans', '2026-08-13-docify.md'),
  'utf8',
)

/** Every `--font-*: ...;` declaration in a document, in source order. */
function fontDeclarations(source: string): string[] {
  return [...source.matchAll(/^\s*(--font-[\w-]+:[^;]+);/gm)].map((match) =>
    match[1].replace(/\s+/g, ' ').trim(),
  )
}

describe('the plan document', () => {
  it('quotes the font tokens exactly as app/globals.css declares them', () => {
    const shipped = fontDeclarations(globalsCss)

    expect(shipped).toHaveLength(3)
    expect(fontDeclarations(plan)).toEqual(shipped)
  })

  it('records why the generic sits inside var()', () => {
    // The reason has to travel with the block, or the next reader "simplifies"
    // the stack back into the form that discards its own fallbacks.
    expect(plan).toMatch(/invalid at computed-value time/i)
  })
})
