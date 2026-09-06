/**
 * Docify agent memory store.
 *
 * Architecture mirrors claude-mem, scoped to this repository:
 *   sessions/<id>.jsonl   raw observations captured during a session (gitignored)
 *   entries/*.md          one durable fact per file (committed)
 *   MEMORY.md             human-readable index (committed)
 *   index.db              SQLite FTS5 search index (gitignored, rebuildable)
 *
 * The markdown files are the source of truth. index.db is a disposable cache —
 * deleting it must never lose information.
 */

import { existsSync, mkdirSync, readdirSync, readFileSync, appendFileSync, writeFileSync } from 'node:fs'
import { Buffer } from 'node:buffer'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import { repoRelative } from './paths.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const MEMORY_DIR = join(HERE, '..', '..', 'memory')
export const ENTRIES_DIR = join(MEMORY_DIR, 'entries')
export const SESSIONS_DIR = join(MEMORY_DIR, 'sessions')
export const INDEX_PATH = join(MEMORY_DIR, 'index.db')
export const INDEX_MD = join(MEMORY_DIR, 'MEMORY.md')

/** Tool calls that carry no durable signal — recording them is pure noise. */
const IGNORED_TOOLS = new Set(['TodoWrite', 'Read', 'Glob', 'Grep', 'NotebookRead'])

export function ensureDirs() {
  for (const dir of [MEMORY_DIR, ENTRIES_DIR, SESSIONS_DIR]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
  }
}

/**
 * Reads the hook payload from stdin.
 *
 * Uses the stream API rather than readFileSync(0): reading fd 0 directly fails
 * when stdin is a pipe on Windows, which silently dropped every observation.
 */
export async function readStdin() {
  try {
    if (process.stdin.isTTY) return {}
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    const raw = Buffer.concat(chunks).toString('utf8').trim()
    return raw ? JSON.parse(raw) : {}
  } catch {
    return {}
  }
}

function sessionFile(sessionId) {
  const safe = String(sessionId || 'unknown').replace(/[^a-zA-Z0-9_-]/g, '')
  return join(SESSIONS_DIR, `${safe}.jsonl`)
}

/**
 * Records a single observation. Deliberately lossy: we store what changed and
 * why it might matter later, never file contents.
 */
export function recordObservation(sessionId, observation) {
  ensureDirs()
  appendFileSync(
    sessionFile(sessionId),
    JSON.stringify({ at: new Date().toISOString(), ...observation }) + '\n',
    'utf8',
  )
}

export function readSession(sessionId) {
  const file = sessionFile(sessionId)
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8')
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line)
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

export function shouldRecord(toolName) {
  return Boolean(toolName) && !IGNORED_TOOLS.has(toolName)
}

/**
 * Extracts a short, human-meaningful label from a tool call.
 *
 * A file outside the repository gets a null target and a summary that names no
 * path: it lives in somebody's temp directory, and an entry file is committed.
 * Callers drop null targets rather than record them.
 */
export function describeToolCall(toolName, toolInput = {}) {
  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit': {
      const target = repoRelative(toolInput.file_path)
      return {
        kind: 'file',
        target,
        summary: target ? `${toolName} ${target}` : `${toolName} (outside the repository)`,
      }
    }
    case 'Bash':
    case 'PowerShell': {
      const cmd = String(toolInput.command || '').slice(0, 160)
      return { kind: 'command', target: cmd.split(/\s+/)[0], summary: cmd }
    }
    case 'Task':
    case 'Agent':
      return { kind: 'agent', target: toolInput.subagent_type || 'agent', summary: toolInput.description || '' }
    default:
      return { kind: 'tool', target: toolName, summary: toolName }
  }
}

/** Machine-independent string order. localeCompare would depend on the runtime's ICU data. */
const byString = (a, b) => (a < b ? -1 : a > b ? 1 : 0)

/**
 * Reads one frontmatter value, quoted or bare.
 *
 * Values are written quoted, because a description reads "Session on
 * 2026-09-04: app, seo" and a bare colon makes that a nested mapping to every
 * YAML parser there is. Bare values still parse: entries written before the
 * quoting are on disk and must keep working.
 */
function unquoteScalar(value) {
  if (!/^".*"$/s.test(value)) return value
  try {
    return JSON.parse(value)
  } catch {
    return value.slice(1, -1).replace(/\\"/g, '"')
  }
}

/**
 * Splits one entry file into its frontmatter fields and its body.
 *
 * The file is normalised before anything is matched: a leading byte-order mark
 * removed, then CR and CRLF folded to LF. Entries are written by hooks at
 * runtime and edited by hand on Windows, so a file may hold CRLF whatever
 * .gitattributes says about the checkout, and a PowerShell redirect leaves a
 * BOM. Either one defeats an anchored `^---` and the failure is silent: the
 * frontmatter block does not match at all, so the entry loses its description,
 * falls back to type `note`, and carries its own header into the indexed body.
 * Normalising once, here, is also what keeps a trailing `\r` off every field.
 */
export function parseEntry(raw, file) {
  const text = raw.replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n')
  const fm = text.match(/^---[ \t]*\n([\s\S]*?)\n---[ \t]*\n?/)
  const meta = {}
  if (fm) {
    for (const line of fm[1].split('\n')) {
      const m = line.match(/^(\w+):\s*(.*)$/)
      if (m) meta[m[1]] = unquoteScalar(m[2].trim())
    }
  }
  return {
    file,
    name: meta.name || file.replace(/\.md$/, ''),
    description: meta.description || '',
    type: meta.type || 'note',
    date: meta.date || '',
    body: (fm ? text.slice(fm[0].length) : text).trim(),
  }
}

/**
 * Reads every entry, newest first. Ties break on filename so that two machines
 * reading the same entries produce the same list — readdirSync order is
 * filesystem-defined, and today every entry carries the same date.
 */
export function listEntries(dir = ENTRIES_DIR) {
  if (dir === ENTRIES_DIR) ensureDirs()
  return readdirSync(dir)
    .filter((f) => f.endsWith('.md'))
    .map((f) => parseEntry(readFileSync(join(dir, f), 'utf8'), f))
    .sort((a, b) => byString(b.date || '', a.date || '') || byString(a.file, b.file))
}

function slugify(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

/**
 * Renders one entry file.
 *
 * Every frontmatter value goes through JSON.stringify: a JSON string is a valid
 * YAML double-quoted scalar, so the colon in a description no longer turns the
 * block into something only this repository's tolerant regex can read.
 */
export function renderEntry({ name, description, type, date, body }) {
  const q = (v) => JSON.stringify(String(v ?? ''))
  return `---
name: ${q(slugify(name))}
description: ${q(description)}
type: ${q(type)}
date: ${q(date)}
---

${String(body).trim()}
`
}

export function writeEntry(entry) {
  ensureDirs()
  const file = join(ENTRIES_DIR, `${slugify(entry.name)}.md`)
  writeFileSync(file, renderEntry(entry), 'utf8')
  rebuildMemoryIndexMd()
  return file
}

/**
 * Renders MEMORY.md from parsed entries.
 *
 * Sections are sorted by type name rather than left in encounter order: encounter
 * order depends on which entry happens to sort first, so adding one entry could
 * reshuffle every heading and make MEMORY.md show up as modified for no reason.
 * Rows keep the caller's order, which listEntries makes newest-first.
 */
export function renderMemoryIndex(entries) {
  const byType = new Map()
  for (const e of entries) {
    if (!byType.has(e.type)) byType.set(e.type, [])
    byType.get(e.type).push(e)
  }

  const sections = [...byType.entries()]
    .sort(([a], [b]) => byString(a, b))
    .map(([type, items]) => {
      const rows = items.map((e) => `- [${e.name}](entries/${e.file}) — ${e.description}`).join('\n')
      return `## ${type}\n\n${rows}`
    })
    .join('\n\n')

  return `# Docify Memory Index

Durable facts carried across sessions. One file per fact in \`entries/\`.
Search with the \`docify-memory\` skill; do not paste whole entries into context.

${sections || '_No entries yet._'}
`
}

/** Regenerates MEMORY.md — the index a human (or a fresh session) reads first. */
export function rebuildMemoryIndexMd() {
  writeFileSync(INDEX_MD, renderMemoryIndex(listEntries()), 'utf8')
}

/**
 * Rebuilds the FTS5 index. Uses node:sqlite when available (Node 22+);
 * silently no-ops otherwise, in which case search falls back to a file scan.
 */
export async function rebuildSearchIndex() {
  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return { indexed: 0, backend: 'none' }
  }

  const db = new DatabaseSync(INDEX_PATH)
  db.exec('DROP TABLE IF EXISTS memories')
  db.exec(`CREATE VIRTUAL TABLE memories USING fts5(name, description, type, date, body)`)

  const insert = db.prepare('INSERT INTO memories (name, description, type, date, body) VALUES (?, ?, ?, ?, ?)')
  const entries = listEntries()
  for (const e of entries) insert.run(e.name, e.description, e.type, e.date, e.body)
  db.close()

  return { indexed: entries.length, backend: 'sqlite' }
}

export async function search(query, limit = 8) {
  let DatabaseSync
  try {
    ({ DatabaseSync } = await import('node:sqlite'))
  } catch {
    return fallbackSearch(query, limit)
  }
  if (!existsSync(INDEX_PATH)) return fallbackSearch(query, limit)

  try {
    const db = new DatabaseSync(INDEX_PATH, { readOnly: true })
    const rows = db
      .prepare(
        `SELECT name, description, type, date, snippet(memories, 4, '', '', '…', 24) AS excerpt
         FROM memories WHERE memories MATCH ? ORDER BY rank LIMIT ?`,
      )
      .all(query, limit)
    db.close()
    return rows
  } catch {
    return fallbackSearch(query, limit)
  }
}

function fallbackSearch(query, limit) {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean)
  return listEntries()
    .map((e) => {
      const hay = `${e.name} ${e.description} ${e.body}`.toLowerCase()
      const score = terms.reduce((n, t) => n + (hay.includes(t) ? 1 : 0), 0)
      return { ...e, score, excerpt: e.body.slice(0, 200) }
    })
    .filter((e) => e.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
}
