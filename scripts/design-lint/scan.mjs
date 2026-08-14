/**
 * The file-collecting half of the design-prohibition gate.
 *
 * Kept apart from rules.mjs so the rules stay free of I/O, and apart from
 * cli.mjs so the tests can assert against the real surface rather than against
 * a copy of the walk.
 *
 * @typedef {import('./rules.mjs').Violation} Violation
 */
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { findViolations, SCANNED_EXTENSIONS } from './rules.mjs'

/**
 * Where styling lives. `test/` and `scripts/` are deliberately outside it: both
 * quote the prohibitions in order to enforce them, and a gate that flagged its
 * own rule table would have to be taught to ignore itself.
 */
export const SURFACE_ROOTS = ['app', 'components', 'lib']

/** Never walked, whether or not a root ever contains them. */
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.next', '.git', 'coverage', 'out', 'build'])

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/**
 * @param {string} absolute
 * @param {string[]} found
 */
function walk(absolute, found) {
  /** @type {import('node:fs').Dirent[]} */
  let entries
  try {
    entries = readdirSync(absolute, { withFileTypes: true })
  } catch {
    // A root that does not exist yet is not a violation.
    return found
  }

  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const child = join(absolute, entry.name)
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(child, found)
    } else if (SCANNED_EXTENSIONS.some((extension) => entry.name.endsWith(extension))) {
      found.push(
        child
          .slice(repoRoot.length + 1)
          .split(sep)
          .join('/'),
      )
    }
  }

  return found
}

/**
 * Every file the gate reads, as repository-relative POSIX paths.
 *
 * @returns {string[]}
 */
export function collectFiles() {
  /** @type {string[]} */
  const found = []
  for (const root of SURFACE_ROOTS) walk(join(repoRoot, root), found)
  return found
}

/**
 * Every violation across the surface, each tagged with the file it came from.
 *
 * @returns {(Violation & { file: string })[]}
 */
export function scanSurface() {
  return collectFiles().flatMap((file) =>
    findViolations(file, readFileSync(join(repoRoot, file), 'utf8')).map((violation) => ({
      file,
      ...violation,
    })),
  )
}
