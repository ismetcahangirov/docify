// @vitest-environment node
//
// Two engines refuse an oversized image for the same reason — past this size a
// browser canvas comes back blank, so the alternative to refusing is handing
// the user an empty file labelled a successful conversion. #181 is about the
// numbers being stated twice, so most of what is asserted here is structural:
// where the numbers live, what importing them costs, and that both guards still
// draw the line in the same place.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { MAX_CANVAS_PIXELS, MAX_CANVAS_SIDE } from '@/lib/engines/canvas-limits'
import { canvasSize } from '@/lib/engines/pdf-render-plan'
import { assertBitmapFits } from '@/lib/engines/raster-limits'

import { staticGraphOf } from '../worker/import-graph'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const LIMITS = 'lib/engines/canvas-limits.ts'

/** The two numbers, as values rather than as the source's spelling of them. */
const LIMITS_VALUES = [MAX_CANVAS_SIDE, MAX_CANVAS_PIXELS]

/**
 * Engine modules that *assign* `value`, whatever digit grouping they use.
 *
 * Underscores are stripped first so `16_384` and `16384` count the same, and
 * only the assignment form counts — the numbers are quoted in prose in more
 * than one header, and prose is not a second definition.
 */
function engineModulesAssigning(value: number): string[] {
  return readdirSync(join(repoRoot, 'lib', 'engines'))
    .filter((name) => name.endsWith('.ts'))
    .filter((name) => {
      const source = readFileSync(join(repoRoot, 'lib', 'engines', name), 'utf8')

      return source.replaceAll('_', '').includes(`= ${value}`)
    })
    .map((name) => `lib/engines/${name}`)
}

describe('where the canvas ceiling is stated', () => {
  it('reads the numbers Safari enforces', () => {
    expect(MAX_CANVAS_SIDE).toBe(16_384)
    expect(MAX_CANVAS_PIXELS).toBe(67_108_864)
  })

  it.each(LIMITS_VALUES)('assigns %i in exactly one engine module', (value) => {
    expect(engineModulesAssigning(value)).toEqual([LIMITS])
  })

  it('costs nothing to import, which is what lets the Canvas engine have it', () => {
    // #160 restated the numbers rather than importing them because the module
    // that had them, `pdf-render-plan`, drags the pdf.js page-planning graph
    // behind it — and the Canvas engine's whole point is that it downloads
    // nothing (CLAUDE.md §2.3). A leaf module is what makes sharing them free.
    expect(staticGraphOf(LIMITS, repoRoot)).toEqual({ files: [], packages: [] })
  })

  it('keeps pdf.js out of what the Canvas engine reaches', () => {
    const graph = staticGraphOf('lib/engines/canvas-runner.ts', repoRoot)

    expect(graph.files).not.toContain('lib/engines/pdf-render-plan.ts')
    expect(graph.packages.filter((name) => /pdf/i.test(name))).toEqual([])
  })
})

describe('the two guards, on the same image', () => {
  const oversized = [
    { width: MAX_CANVAS_SIDE + 1, height: 10 },
    { width: 16_000, height: 16_000 },
  ]
  const admitted = [
    { width: MAX_CANVAS_SIDE, height: 4096 },
    { width: 8000, height: 6000 },
  ]

  it.each(oversized)('both refuse $width × $height', (size) => {
    expect(() => assertBitmapFits('"wall.png"', size)).toThrow()
    expect(() => canvasSize(size, 7, 1200)).toThrow()
  })

  it.each(admitted)('both admit $width × $height', (size) => {
    expect(() => assertBitmapFits('"wall.png"', size)).not.toThrow()
    expect(() => canvasSize(size, 7, 1200)).not.toThrow()
  })
})
