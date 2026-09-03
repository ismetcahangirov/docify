import { describe, expect, it } from 'vitest'

import { firstLoadFiles, wasmInFirstLoad } from '../scripts/initial-bundle/wasm.mjs'

/*
 * The build half of the no-WASM gate (issue #76), tested on synthetic manifests.
 *
 * The rules are asserted against strings rather than against a real `.next`, for
 * the reason `test/design-lint.test.ts` gives about fixtures: this suite has to
 * be able to describe a *failing* build, and there is no way to produce one on
 * disk without shipping the very thing the gate exists to refuse.
 *
 * What it cannot check is that a real build still parses this way. That is what
 * running the gate in CI's build job is for — with a real manifest, on every
 * pull request.
 */

const manifest = {
  pages: {
    '/layout': ['static/chunks/shared.js'],
    '/convert/layout': ['static/chunks/convert-layout.js'],
    '/convert/[pair]/page': ['static/chunks/pair.js'],
    '/page': ['static/chunks/home.js', 'static/chunks/shared.js'],
  },
}

describe('firstLoadFiles', () => {
  it('unions a page entry with every ancestor layout, as the browser does', () => {
    const entries = firstLoadFiles(manifest, { '/convert/[pair]/page': '/convert/[pair]' })

    expect(entries).toEqual([
      {
        route: '/convert/[pair]',
        files: [
          'static/chunks/shared.js',
          'static/chunks/convert-layout.js',
          'static/chunks/pair.js',
        ],
      },
    ])
  })

  it('lists a chunk once however many entries name it', () => {
    const [entry] = firstLoadFiles(manifest, { '/page': '/' })

    expect(entry?.files).toEqual(['static/chunks/shared.js', 'static/chunks/home.js'])
  })

  it('keeps files the bundle budget filters away, which is why the walk is repeated', () => {
    const withBinary = { pages: { '/layout': [], '/page': ['static/media/vips.wasm'] } }
    const [entry] = firstLoadFiles(withBinary, { '/page': '/' })

    expect(entry?.files).toEqual(['static/media/vips.wasm'])
  })

  it('answers nothing for a build with no routes, rather than inventing one', () => {
    expect(firstLoadFiles(manifest, {})).toEqual([])
  })
})

describe('wasmInFirstLoad', () => {
  it('reports a binary listed among a route first-load files', () => {
    const findings = wasmInFirstLoad({
      entries: [{ route: '/', files: ['static/chunks/a.js', 'static/media/vips.wasm'] }],
      readChunk: () => '',
    })

    expect(findings).toEqual([
      {
        route: '/',
        file: 'static/media/vips.wasm',
        reason: 'the route downloads this binary directly',
      },
    ])
  })

  it('reports a first-load chunk that names a binary sitting somewhere else', () => {
    // The case a search of the chunk directory cannot find: the chunk is
    // JavaScript, and the megabytes it fetches are one string away.
    const findings = wasmInFirstLoad({
      entries: [{ route: '/convert/heic-to-jpg', files: ['static/chunks/pair.js'] }],
      readChunk: () => 'fetch("/vendor/ffmpeg/ffmpeg-core.wasm")',
    })

    expect(findings).toHaveLength(1)
    expect(findings[0]?.reason).toMatch(/names a \.wasm/u)
  })

  it('reports every route a shared chunk poisons, not just the first', () => {
    const findings = wasmInFirstLoad({
      entries: [
        { route: '/', files: ['static/chunks/shared.js'] },
        { route: '/convert', files: ['static/chunks/shared.js'] },
      ],
      readChunk: () => 'new URL("engine.wasm", import.meta.url)',
    })

    expect(findings.map((finding) => finding.route)).toEqual(['/', '/convert'])
  })

  it('does not read a stylesheet looking for JavaScript', () => {
    // `.css` is in a first-load set and is not a chunk. Reading it would be
    // harmless and pointless; the assertion is here so that stays true.
    const read: string[] = []
    wasmInFirstLoad({
      entries: [{ route: '/', files: ['static/css/a.css'] }],
      readChunk: (file) => {
        read.push(file)
        return ''
      },
    })

    expect(read).toEqual([])
  })

  it('says nothing about a clean build', () => {
    const findings = wasmInFirstLoad({
      entries: [{ route: '/', files: ['static/chunks/a.js', 'static/css/a.css'] }],
      readChunk: () => 'export const x = 1',
    })

    expect(findings).toEqual([])
  })
})
