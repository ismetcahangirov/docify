import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

/*
 * `.env.example`, checked against the code that reads the environment (issue #302).
 *
 * ## Why this is a test and not a habit
 *
 * The file says it itself, in the comment a reader meets before any variable:
 *
 *   > a variable that exists only in a deployment dashboard is a variable the
 *   > next environment forgets to set.
 *
 * That sentence is a promise about a list, and a list is the one kind of
 * documentation that goes wrong silently. Nothing fails when a variable is
 * added to the code and not to the file — the build passes, every page renders,
 * and the feature the variable turns on is simply absent from the next
 * deployment, which looks exactly like a feature nobody asked for.
 *
 * `NEXT_PUBLIC_PROXY_URL` was in that state: read by `lib/import/url.ts`,
 * described in `README.md`, and missing from both `.env.example` and the
 * environment table of `docs/deploy/vercel.md`.
 *
 * ## Why both directions are asserted
 *
 * A name in the code and not in the file is the failure above. A name in the
 * file and not in the code is the opposite one: an operator setting a variable
 * that does nothing, and reasonably concluding the deployment is broken when it
 * changes nothing. Neither is worth more than the other, so both are errors.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

/** Where the application reads its own configuration from. `services/` has its own, declared in `render.yaml`. */
const SOURCE_DIRS = ['app', 'lib', 'components']

/**
 * Anything the platform sets rather than the operator.
 *
 * `NODE_ENV` is not Docify's to declare — it is set by `next build`, by Vitest
 * and by Render, and a line for it in `.env.example` would invite somebody to
 * override it.
 */
const PLATFORM = new Set(['NODE_ENV'])

/**
 * `process.env.X` and the `env.X` of a function that takes the environment as a
 * parameter — `lib/seo/verification.ts` does the latter, deliberately, so it is
 * testable without mutating global state (CLAUDE.md §5.1).
 */
const READ = /\b(?:process\.)?env\.([A-Z][A-Z0-9_]*)/g

/** `NAME=` at the start of a line, which is what a declaration looks like with or without a value. */
const DECLARED = /^([A-Z][A-Z0-9_]*)=/gm

function sourceFiles(): string[] {
  return SOURCE_DIRS.flatMap((dir) =>
    (readdirSync(join(repoRoot, dir), { recursive: true }) as string[])
      .filter((entry) => entry.endsWith('.ts') || entry.endsWith('.tsx'))
      .map((entry) => join(repoRoot, dir, entry)),
  )
}

function namesRead(): Map<string, Set<string>> {
  const found = new Map<string, Set<string>>()

  for (const file of sourceFiles()) {
    const source = readFileSync(file, 'utf8')
    // Posix separators so a failure reads the same on Windows as in CI.
    const relative = file
      .slice(repoRoot.length + 1)
      .split(sep)
      .join('/')

    for (const [, name] of source.matchAll(READ)) {
      if (PLATFORM.has(name)) continue
      found.set(name, (found.get(name) ?? new Set()).add(relative))
    }
  }

  return found
}

function namesDeclared(): string[] {
  const example = readFileSync(join(repoRoot, '.env.example'), 'utf8')

  return [...example.matchAll(DECLARED)].map(([, name]) => name)
}

describe('.env.example', () => {
  it('declares every variable the application reads', () => {
    const declared = new Set(namesDeclared())
    const undeclared = [...namesRead()].filter(([name]) => !declared.has(name))

    expect(undeclared.map(([name, files]) => `${name} (read in ${[...files].join(', ')})`)).toEqual(
      [],
    )
  })

  it('reads every variable it declares', () => {
    const read = namesRead()

    expect(namesDeclared().filter((name) => !read.has(name))).toEqual([])
  })

  it('finds the variables at all, so an empty pass cannot look like a green one', () => {
    expect([...namesRead().keys()].sort()).toEqual([
      'DATABASE_URL',
      'GOOGLE_SITE_VERIFICATION',
      'NEXT_PUBLIC_PROXY_URL',
    ])
  })
})
