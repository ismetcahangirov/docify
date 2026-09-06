/**
 * Path helpers shared by the memory hooks.
 *
 * Two questions are asked of every path a tool call reports: is it inside this
 * repository at all, and which part of the project does it belong to. Both
 * answers are derived from the path itself — no allowlist to fall out of date.
 */

import { dirname, isAbsolute, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this file rather than from the process cwd. */
const ROOT = normalise(resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..'))

function normalise(p) {
  return String(p ?? '')
    .replace(/\\/g, '/')
    .replace(/\/+$/, '')
}

/**
 * Reduces a path to its repository-relative form, or returns null when it does
 * not live in the repository.
 *
 * Null is the important half. The session scratchpad lives under the OS temp
 * directory, so a string split on `/docify/` left the whole absolute path — the
 * account name, the machine layout and the session UUID — in an entry that is
 * committed on purpose. Anything outside the tree is not recorded at all.
 */
export function repoRelative(path) {
  const p = normalise(path)
  if (!p) return null

  // A relative path is already what we want; a tool that reports one reports it
  // relative to the repository root.
  if (!isAbsolute(p) && !/^[a-zA-Z]:/.test(p)) {
    return p.replace(/^\.\//, '') || null
  }

  // Windows hands the hook whichever drive-letter case the caller typed.
  const prefix = `${ROOT}/`
  if (!p.toLowerCase().startsWith(prefix.toLowerCase())) return null
  return p.slice(prefix.length) || null
}

/** Areas that do not follow the `lib/<area>` shape, longest prefix first. */
const FIXED_AREAS = [
  ['app/api/', 'backend'],
  ['app/', 'app'],
  ['components/', 'ui'],
  ['services/', 'backend'],
  ['scripts/', 'ci'],
  ['.github/', 'ci'],
  ['docs/', 'docs'],
  ['e2e/', 'test'],
  ['test/', 'test'],
  ['.claude/', 'agent'],
]

/**
 * Maps a repository-relative path to a project area, so summaries stay
 * searchable by concern.
 *
 * Derived, not enumerated: `lib/<x>/…` is area `x`, which is why a new
 * `lib/whatever` needs no edit here. Everything else falls back to its first
 * path segment rather than to a bucket named "other", which used to swallow
 * `lib/db`, `lib/analytics`, `docs/` and `e2e/` alike.
 */
export function areaOf(path) {
  const p = normalise(path)
  if (!p) return null

  const lib = p.match(/^lib\/([^/]+)\//)
  if (lib) return lib[1]

  for (const [prefix, area] of FIXED_AREAS) {
    if (p.startsWith(prefix)) return area
  }

  const slash = p.indexOf('/')
  return slash === -1 ? 'root' : p.slice(0, slash)
}
