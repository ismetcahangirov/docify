import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * The upload steps in `.github/workflows/ci.yml`, asserted from the outside.
 *
 * ## Why a test reads a workflow file
 *
 * Issue #250: the `lighthouse` job wrote nine reports and uploaded none of them
 * for the entire life of the gate. `actions/upload-artifact@v4` stopped
 * following hidden paths in v4.4 — `include-hidden-files` defaults to false —
 * and `.lighthouseci/` is a dot-directory, so the glob matched nothing. The
 * step still passed, because `if-no-files-found` defaults to `warn`.
 *
 * That is the shape of the bug worth guarding: not a wrong value, but a silent
 * one. Nothing in a green run said the evidence behind the gate was missing,
 * and nothing would have — the only way to notice was to go looking for a
 * report that had never existed. CI cannot check itself here, so the unit suite
 * does.
 *
 * The assertions are deliberately about the two settings that decide whether a
 * failure is loud, and not about the rest of the step. A test that pinned the
 * artifact name or the retention window would fail on every rename and teach
 * whoever hit it to stop reading this file.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const workflow = readFileSync(join(repoRoot, '.github', 'workflows', 'ci.yml'), 'utf8')

/**
 * Every `actions/upload-artifact` step in the workflow, as its own block of text.
 *
 * Split on the `- uses:` that starts each step rather than parsed as YAML: the
 * repository has no YAML parser, and adding one to assert two keys would be a
 * dependency bought for a single test.
 */
const uploadSteps = workflow
  .split(/^ {6}- uses:/m)
  .slice(1)
  .map((step) => `- uses:${step}`)
  .filter((step) => step.startsWith('- uses: actions/upload-artifact'))

/** The value of one key inside a step block, or `undefined` when it is absent. */
function setting(step: string, key: string): string | undefined {
  const prefix = `${key}:`

  for (const line of step.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith(prefix)) return trimmed.slice(prefix.length).trim()
  }

  return undefined
}

describe('.github/workflows/ci.yml artifact uploads', () => {
  it('uploads something from more than one job', () => {
    // A guard on the split above: a pattern that stopped matching would leave
    // every assertion below vacuously true.
    expect(uploadSteps.length).toBeGreaterThanOrEqual(2)
  })

  it('follows hidden paths wherever the path is a dot-directory', () => {
    for (const step of uploadSteps) {
      const path = setting(step, 'path')
      if (path === undefined || !path.startsWith('.')) continue

      expect(setting(step, 'include-hidden-files')).toBe('true')
    }
  })

  it('fails rather than warns when an upload finds no files', () => {
    for (const step of uploadSteps) {
      expect(setting(step, 'if-no-files-found')).toBe('error')
    }
  })

  it('still uploads the Lighthouse reports when the gate failed', () => {
    const lighthouse = uploadSteps.find((step) => setting(step, 'path') === '.lighthouseci/')

    // The report is only ever interesting because an assertion failed, so a
    // step that ran on success only would upload exactly the runs nobody reads.
    expect(lighthouse).toBeDefined()
    expect(setting(lighthouse ?? '', 'if')).toBe('always()')
  })
})
