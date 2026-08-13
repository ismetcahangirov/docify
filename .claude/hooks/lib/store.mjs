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

/** Extracts a short, human-meaningful label from a tool call. */
export function describeToolCall(toolName, toolInput = {}) {
  const rel = (p) => String(p || '').replace(/\\/g, '/').split('/docify/').pop() ?? p

  switch (toolName) {
    case 'Edit':
    case 'Write':
    case 'NotebookEdit':
      return { kind: 'file', target: rel(toolInput.file_path), summary: `${toolName} ${rel(toolInput.file_path)}` }
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

export function listEntries() {
  ensureDirs()
  return readdirSync(ENTRIES_DIR)
    .filter((f) => f.endsWith('.md'))
    .map((f) => {
      const raw = readFileSync(join(ENTRIES_DIR, f), 'utf8')
      const fm = raw.match(/^---\n([\s\S]*?)\n---\n?/)
      const meta = {}
      if (fm) {
        for (const line of fm[1].split('\n')) {
          const m = line.match(/^(\w+):\s*(.*)$/)
          if (m) meta[m[1]] = m[2].trim()
        }
      }
      return {
        file: f,
        name: meta.name || f.replace(/\.md$/, ''),
        description: meta.description || '',
        type: meta.type || 'note',
        date: meta.date || '',
        body: raw.replace(/^---\n[\s\S]*?\n---\n?/, '').trim(),
      }
    })
    .sort((a, b) => (b.date || '').localeCompare(a.date || ''))
}

export function writeEntry({ name, description, type, date, body }) {
  ensureDirs()
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
  const file = join(ENTRIES_DIR, `${slug}.md`)
  const content = `---
name: ${slug}
description: ${description}
type: ${type}
date: ${date}
---

${body.trim()}
`
  writeFileSync(file, content, 'utf8')
  rebuildMemoryIndexMd()
  return file
}

/** Regenerates MEMORY.md — the index a human (or a fresh session) reads first. */
export function rebuildMemoryIndexMd() {
  const entries = listEntries()
  const byType = new Map()
  for (const e of entries) {
    if (!byType.has(e.type)) byType.set(e.type, [])
    byType.get(e.type).push(e)
  }

  const sections = [...byType.entries()]
    .map(([type, items]) => {
      const rows = items.map((e) => `- [${e.name}](entries/${e.file}) — ${e.description}`).join('\n')
      return `## ${type}\n\n${rows}`
    })
    .join('\n\n')

  writeFileSync(
    INDEX_MD,
    `# Docify Memory Index

Durable facts carried across sessions. One file per fact in \`entries/\`.
Search with the \`docify-memory\` skill; do not paste whole entries into context.

${sections || '_No entries yet._'}
`,
    'utf8',
  )
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
