/**
 * A miniature module-graph walker, used to assert CLAUDE.md §2.3 against the
 * source on disk.
 *
 * It answers one question: which modules would a bundler pull into the chunk it
 * emits for a given entry? That is the transitive closure of *static* imports,
 * cut at every `await import()` — which is exactly the cut that keeps a 32 MB
 * WASM engine out of the worker shell.
 *
 * Test-support code, not shipped.
 */

import { existsSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve } from 'node:path'

import ts from 'typescript'

/** Not code: a bundler emits these as assets, so they are not graph nodes. */
const NON_CODE = /\.(css|scss|svg|png|jpe?g|gif|webp|avif|woff2?|ttf|otf)$/i

/** Extensions a bundler tries, in order, for an extensionless specifier. */
const CANDIDATE_SUFFIXES = ['', '.ts', '.tsx', '.mts', '.js', '/index.ts', '/index.tsx']

/**
 * The specifiers of every import that survives compilation.
 *
 * Parsed with the TypeScript compiler rather than matched with a regex: this
 * codebase is semicolon-free, so a regex clause that may span newlines lets one
 * `export type` swallow the value re-export on the following line — a leak the
 * guard is supposed to catch would sail through green.
 *
 * `import type` / `export type` are dropped because tsc erases them. An import
 * whose named bindings are *individually* type-only (`import { type A } from
 * 'x'`) is still reported: tsc elides it too, but counting it fails closed,
 * which is the safe direction for a guard.
 *
 * `import('…')` is an expression, never an `ImportDeclaration`, so it is never
 * reported — which is the bundler's chunk boundary and the whole point.
 */
export function valueImportsOf(source: string): string[] {
  const parsed = ts.createSourceFile('module.ts', source, ts.ScriptTarget.ESNext, false)
  const specifiers: string[] = []

  for (const statement of parsed.statements) {
    if (ts.isImportDeclaration(statement)) {
      if (statement.importClause?.isTypeOnly) continue
    } else if (ts.isExportDeclaration(statement)) {
      if (statement.isTypeOnly || statement.moduleSpecifier === undefined) continue
    } else {
      continue
    }

    const moduleSpecifier = statement.moduleSpecifier
    if (moduleSpecifier !== undefined && ts.isStringLiteral(moduleSpecifier)) {
      specifiers.push(moduleSpecifier.text)
    }
  }

  return specifiers
}

/**
 * Resolves a specifier to a repo-relative path, mirroring the `@/*` alias in
 * tsconfig.json.
 *
 * Returns `null` for a bare specifier (an npm package — a leaf, not walked) and
 * for a non-code asset. Anything that looks like a local module but resolves to
 * no file throws: a guard that quietly skips what it cannot resolve is a guard
 * that passes on the day it matters.
 */
export function resolveLocal(specifier: string, fromFile: string, repoRoot: string): string | null {
  const path = specifier.split('?')[0]
  if (NON_CODE.test(path)) return null

  const base = path.startsWith('@/')
    ? join(repoRoot, path.slice(2))
    : path.startsWith('.')
      ? resolve(repoRoot, dirname(fromFile), path)
      : null

  if (base === null) return null

  // `./x.js` is how ESM refers to `./x.ts`; try the source file too.
  const roots = base.endsWith('.js') ? [base.slice(0, -3), base] : [base]

  for (const root of roots) {
    for (const suffix of CANDIDATE_SUFFIXES) {
      const candidate = `${root}${suffix}`
      if (existsSync(candidate) && statSync(candidate).isFile()) {
        return posix.join(...relative(repoRoot, candidate).split(/[\\/]/))
      }
    }
  }

  throw new Error(`Cannot resolve "${specifier}" imported from ${fromFile}`)
}

export interface Graph {
  /** Repo-relative paths of every local module a bundler would pull in. */
  files: string[]
  /** Bare specifiers — the npm packages that end up in the chunk. */
  packages: string[]
}

/** The transitive closure of the value imports reachable from `entry`. */
export function staticGraphOf(entry: string, repoRoot: string): Graph {
  const files = new Set<string>()
  const packages = new Set<string>()
  const queue = [entry]

  while (queue.length > 0) {
    const file = queue.pop()!
    if (files.has(file)) continue
    files.add(file)

    for (const specifier of valueImportsOf(readFileSync(join(repoRoot, file), 'utf8'))) {
      const local = resolveLocal(specifier, file, repoRoot)
      if (local === null) packages.add(specifier)
      else queue.push(local)
    }
  }

  files.delete(entry)
  return { files: [...files].sort(), packages: [...packages].sort() }
}
