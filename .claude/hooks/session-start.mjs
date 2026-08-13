#!/usr/bin/env node
/**
 * SessionStart hook — injects the memory index into a fresh session.
 *
 * Deliberately loads only the *index* (name + one-line description), never full
 * entry bodies. Full entries are pulled on demand via the docify-memory skill.
 * This is the progressive-disclosure pattern: cheap by default, deep on request.
 */

import { existsSync, readFileSync } from 'node:fs'
import { readStdin, ensureDirs, listEntries, rebuildSearchIndex, INDEX_MD } from './lib/store.mjs'

try {
  await readStdin()
  ensureDirs()
  await rebuildSearchIndex()

  const entries = listEntries()

  let context
  if (entries.length === 0) {
    context = [
      'Docify agent memory: no entries yet.',
      'When you make an architectural decision whose rationale is not visible in the code,',
      'record it with the `docify-memory` skill.',
    ].join(' ')
  } else {
    const index = entries.map((e) => `- ${e.name} (${e.type}) — ${e.description}`).join('\n')
    context = `## Docify agent memory (${entries.length} entries)

These are durable facts from earlier sessions. Descriptions only — use the
\`docify-memory\` skill to read a full entry before relying on it.

${index}

Entries reflect what was true when written. Verify any file, symbol or flag
they name still exists before acting on it.`
  }

  // Fall back to the committed index file if enumeration produced nothing useful.
  if (!context.trim() && existsSync(INDEX_MD)) {
    context = readFileSync(INDEX_MD, 'utf8')
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: 'SessionStart',
        additionalContext: context,
      },
    }),
  )
} catch {
  // Never block session start.
}

process.exit(0)
