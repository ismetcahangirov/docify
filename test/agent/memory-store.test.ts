// The memory store is a Node script that reads the filesystem directly, so it is
// tested in the node environment rather than the project-wide jsdom one.
// @vitest-environment node

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { afterAll, beforeAll, describe, expect, it } from 'vitest'

import { listEntries, parseEntry, renderMemoryIndex } from '../../.claude/hooks/lib/store.mjs'

/**
 * The memory store is read on Windows, where entries reach the working tree with
 * CRLF endings — from an editor, from a hook writing at runtime, or from a clone
 * made before `.gitattributes` pinned `eol=lf`. Fixtures are written at runtime
 * rather than committed, because a committed CRLF file would be normalised back
 * to LF on checkout and this regression would stop being covered. The LF fixture
 * is joined explicitly rather than written as a template literal, so it cannot
 * inherit this file's own line endings and quietly stop being the LF case.
 */
const ENTRY = [
  '---',
  'name: monochrome-design-constraint',
  'description: The palette is monochrome by owner mandate',
  'type: constraint',
  'date: 2026-08-13',
  '---',
  '',
  'Flat fill plus a 1px border, never a gradient.',
  'Second body line.',
  '',
].join('\n')

const CRLF_ENTRY = ENTRY.replace(/\n/g, '\r\n')

/** CRLF frontmatter with an LF body — what an editor that rewrote only the header leaves behind. */
const MIXED_ENTRY = (() => {
  const closing = CRLF_ENTRY.indexOf('---\r\n', 4) + '---\r\n'.length
  return CRLF_ENTRY.slice(0, closing) + CRLF_ENTRY.slice(closing).replace(/\r\n/g, '\n')
})()

let dir: string

function entry(file: string) {
  const found = listEntries(dir).find((e) => e.file === file)
  if (!found) throw new Error(`fixture ${file} was not listed`)
  return found
}

beforeAll(() => {
  dir = mkdtempSync(join(tmpdir(), 'docify-memory-'))
  writeFileSync(join(dir, 'lf.md'), ENTRY, 'utf8')
  writeFileSync(join(dir, 'crlf.md'), CRLF_ENTRY, 'utf8')
  writeFileSync(join(dir, 'mixed.md'), MIXED_ENTRY, 'utf8')
})

afterAll(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('listEntries frontmatter parsing', () => {
  it('reads every field from a CRLF entry file', () => {
    expect(entry('crlf.md')).toMatchObject({
      name: 'monochrome-design-constraint',
      description: 'The palette is monochrome by owner mandate',
      type: 'constraint',
      date: '2026-08-13',
    })
  })

  it('parses a CRLF entry exactly as it parses the LF original', () => {
    const lf = entry('lf.md')
    const crlf = entry('crlf.md')
    expect({ ...crlf, file: lf.file }).toEqual(lf)
  })

  it('parses an entry whose frontmatter is CRLF but whose body is LF', () => {
    expect(entry('mixed.md').type).toBe('constraint')
  })

  it('leaves no carriage return in any parsed value', () => {
    const parsed = entry('crlf.md')
    expect(parsed.description).not.toMatch(/\r/)
    expect(parsed.type).not.toMatch(/\r/)
    expect(parsed.date).not.toMatch(/\r/)
    expect(parsed.body).not.toMatch(/\r/)
  })

  it('strips the frontmatter block from the body', () => {
    expect(entry('crlf.md').body).toBe(
      'Flat fill plus a 1px border, never a gradient.\nSecond body line.',
    )
  })

  it('breaks date ties on filename, not on filesystem order', () => {
    // All three fixtures share a date, so without a tie-break the order would be
    // whatever readdirSync returns — sorted on NTFS, hashed on ext4.
    expect(listEntries(dir).map((e) => e.file)).toEqual(['crlf.md', 'lf.md', 'mixed.md'])
  })

  it('reads the committed entries when called with no argument', () => {
    const entries = listEntries()
    expect(entries.length).toBeGreaterThan(0)
    // Every committed entry carries frontmatter, so none may land on the fallbacks.
    for (const e of entries) {
      expect(e.description, `${e.file} lost its description`).not.toBe('')
      expect(e.type, `${e.file} fell back to the default type`).not.toBe('note')
    }
  })
})

describe('parseEntry', () => {
  it('survives a UTF-8 byte-order mark, which a PowerShell redirect leaves behind', () => {
    expect(parseEntry(`\uFEFF${ENTRY}`, 'bom.md').type).toBe('constraint')
  })

  it('tolerates trailing whitespace on the fence lines', () => {
    expect(parseEntry(ENTRY.replace(/^---$/gm, '--- '), 'loose.md').type).toBe('constraint')
  })

  it('falls back to the filename and type note only when there is no frontmatter', () => {
    expect(parseEntry('Just a body.\n', 'orphan.md')).toEqual({
      file: 'orphan.md',
      name: 'orphan',
      description: '',
      type: 'note',
      date: '',
      body: 'Just a body.',
    })
  })
})

describe('renderMemoryIndex', () => {
  const entries = [
    {
      file: 'w.md',
      name: 'w',
      description: 'a decision',
      type: 'decision',
      date: '2026-08-13',
      body: '',
    },
    {
      file: 'm.md',
      name: 'm',
      description: 'a constraint',
      type: 'constraint',
      date: '2026-08-12',
      body: '',
    },
    {
      file: 'p.md',
      name: 'p',
      description: 'a process note',
      type: 'process',
      date: '2026-08-11',
      body: '',
    },
  ]

  it('emits sections in a stable order regardless of the order entries arrive in', () => {
    const headings = (md: string) => md.match(/^## .+$/gm)
    expect(headings(renderMemoryIndex(entries))).toEqual([
      '## constraint',
      '## decision',
      '## process',
    ])
    expect(renderMemoryIndex([...entries].reverse())).toBe(renderMemoryIndex(entries))
  })

  it('keeps each entry description on its row', () => {
    expect(renderMemoryIndex(entries)).toContain('- [m](entries/m.md) — a constraint')
  })

  it('says so explicitly when there is nothing to index', () => {
    expect(renderMemoryIndex([])).toContain('_No entries yet._')
  })
})
