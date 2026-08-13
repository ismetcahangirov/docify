#!/usr/bin/env node
/**
 * SessionEnd hook — compresses a session's raw observations into one summary entry.
 *
 * Compression is the whole point: a session may produce 300 observations, of which
 * maybe five sentences matter next week. We keep the shape of the work (which areas
 * were touched, what failed) and drop the rest.
 *
 * Note: this hook writes a *session summary*. Durable architectural decisions are
 * written deliberately via the docify-memory skill, not inferred here.
 */

import { readStdin, readSession, writeEntry, rebuildSearchIndex } from './lib/store.mjs'

/** Maps a touched path to a project area, so summaries stay searchable by concern. */
function areaOf(path = '') {
  if (path.includes('lib/router')) return 'router'
  if (path.includes('lib/engines')) return 'engines'
  if (path.includes('lib/registry')) return 'registry'
  if (path.includes('lib/seo') || path.includes('sitemap') || path.includes('robots')) return 'seo'
  if (path.includes('components/')) return 'ui'
  if (path.includes('app/api')) return 'backend'
  if (path.includes('.github/')) return 'ci'
  if (path.includes('.claude/')) return 'agent'
  if (path.includes('app/')) return 'app'
  return 'other'
}

try {
  const input = await readStdin()
  const observations = readSession(input.session_id)

  // Nothing meaningful happened — do not pollute memory with an empty entry.
  if (observations.length >= 3) {
    const files = observations.filter((o) => o.kind === 'file')
    const commands = observations.filter((o) => o.kind === 'command')
    const failures = observations.filter((o) => o.failed)

    const areas = [...new Set(files.map((f) => areaOf(f.target)))].filter((a) => a !== 'other')
    const touched = [...new Set(files.map((f) => f.target))].slice(0, 15)
    const date = new Date().toISOString().slice(0, 10)
    const id = String(input.session_id || 'unknown').slice(0, 8)

    const body = [
      `Areas touched: ${areas.length ? areas.join(', ') : 'none identified'}`,
      '',
      `Files changed (${files.length} operations):`,
      ...touched.map((f) => `- \`${f}\``),
      '',
      `Commands run: ${commands.length}. Failed operations: ${failures.length}.`,
      failures.length
        ? `\nFailures worth remembering:\n${failures.slice(0, 5).map((f) => `- ${f.tool}: ${f.summary}`).join('\n')}`
        : '',
    ]
      .filter(Boolean)
      .join('\n')

    writeEntry({
      name: `session-${date}-${id}`,
      description: `Session on ${date}: ${areas.join(', ') || 'general work'} (${files.length} file ops)`,
      type: 'session',
      date,
      body,
    })

    await rebuildSearchIndex()
  }
} catch {
  // Never block session end.
}

process.exit(0)
