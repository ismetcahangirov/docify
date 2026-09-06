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

import { areaOf } from './lib/paths.mjs'
import { readStdin, readSession, writeEntry, rebuildSearchIndex } from './lib/store.mjs'

/** How many file names one summary lists before it says how many it left out. */
const MAX_LISTED = 15

try {
  const input = await readStdin()
  const observations = readSession(input.session_id)

  // Nothing meaningful happened — do not pollute memory with an empty entry.
  if (observations.length >= 3) {
    // A file outside the repository carries no target: it is somebody's temp
    // directory, and this entry is committed. It must not take a listed slot
    // either, which is why it is dropped before anything is counted.
    const files = observations.filter((o) => o.kind === 'file' && o.target)
    const commands = observations.filter((o) => o.kind === 'command')
    const failures = observations.filter((o) => o.failed)

    const areas = [...new Set(files.map((f) => areaOf(f.target)))].filter(Boolean)
    const unique = [...new Set(files.map((f) => f.target))]
    const touched = unique.slice(0, MAX_LISTED)
    const date = new Date().toISOString().slice(0, 10)
    const id = String(input.session_id || 'unknown').slice(0, 8)

    const body = [
      `Areas touched: ${areas.length ? areas.join(', ') : 'none identified'}`,
      '',
      `Files changed (${unique.length}):`,
      ...touched.map((f) => `- \`${f}\``),
      unique.length > touched.length ? `- … and ${unique.length - touched.length} more` : '',
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
