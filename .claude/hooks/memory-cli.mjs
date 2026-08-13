#!/usr/bin/env node
/**
 * Memory CLI — the interface the docify-memory skill drives.
 *
 *   node .claude/hooks/memory-cli.mjs search "webcodecs fallback"
 *   node .claude/hooks/memory-cli.mjs get <entry-name>
 *   node .claude/hooks/memory-cli.mjs list [type]
 *   node .claude/hooks/memory-cli.mjs write <type> <name> <description> <body>
 *   node .claude/hooks/memory-cli.mjs reindex
 */

import { listEntries, search, writeEntry, rebuildSearchIndex, rebuildMemoryIndexMd } from './lib/store.mjs'

const [command, ...args] = process.argv.slice(2)
const VALID_TYPES = ['decision', 'constraint', 'gotcha', 'reference', 'session']

function out(v) {
  process.stdout.write(typeof v === 'string' ? v + '\n' : JSON.stringify(v, null, 2) + '\n')
}

switch (command) {
  case 'search': {
    const query = args.join(' ')
    if (!query) {
      out('Usage: memory-cli.mjs search "<query>"')
      process.exit(1)
    }
    const results = await search(query)
    if (!results.length) {
      out(`No memory entries match "${query}".`)
      break
    }
    out(results.map((r) => `${r.name} [${r.type}] — ${r.description}\n    ${r.excerpt ?? ''}`).join('\n\n'))
    break
  }

  case 'get': {
    const name = args[0]
    const entry = listEntries().find((e) => e.name === name)
    if (!entry) {
      out(`No entry named "${name}".`)
      process.exit(1)
    }
    out(`# ${entry.name} [${entry.type}] ${entry.date}\n\n${entry.description}\n\n${entry.body}`)
    break
  }

  case 'list': {
    const filter = args[0]
    const entries = listEntries().filter((e) => !filter || e.type === filter)
    out(entries.map((e) => `${e.name} [${e.type}] ${e.date} — ${e.description}`).join('\n') || 'No entries.')
    break
  }

  case 'write': {
    const [type, name, description, ...bodyParts] = args
    if (!VALID_TYPES.includes(type) || !name || !description || !bodyParts.length) {
      out(`Usage: memory-cli.mjs write <${VALID_TYPES.join('|')}> <name> <description> <body>`)
      process.exit(1)
    }
    const file = writeEntry({
      type,
      name,
      description,
      date: new Date().toISOString().slice(0, 10),
      body: bodyParts.join(' '),
    })
    await rebuildSearchIndex()
    out(`Wrote ${file}`)
    break
  }

  case 'reindex': {
    rebuildMemoryIndexMd()
    const result = await rebuildSearchIndex()
    out(`Reindexed ${result.indexed} entries (backend: ${result.backend}).`)
    break
  }

  default:
    out('Commands: search | get | list | write | reindex')
    process.exit(1)
}
