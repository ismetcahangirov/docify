// @vitest-environment node
//
// Two halves of one convention: what a cancelled engine throws, and what
// recognises it afterwards. Before #178 the throwing half was written out nine
// times and the recognising half once, in a tenth file, which is a convention
// with ten edit sites and no obvious first one.
//
// Most of what follows is about the *rule* rather than the arithmetic — that a
// name is what is matched, never a type, and that the one cancellation pdf.js
// raises under a different name stays unmatched.

import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { ABORT_ERROR_NAME, CANCELLED_MESSAGE, isAbort, throwIfAborted } from '@/lib/abort'
import { ConversionCancelledError } from '@/lib/worker/errors'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const OWNER = 'lib/abort.ts'

function aborted(): AbortSignal {
  const controller = new AbortController()
  controller.abort()

  return controller.signal
}

/** Every `.ts` under `lib/`, repo-relative. */
function libModules(directory = 'lib'): string[] {
  return readdirSync(join(repoRoot, directory), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? libModules(`${directory}/${entry.name}`)
      : entry.name.endsWith('.ts')
        ? [`${directory}/${entry.name}`]
        : [],
  )
}

describe('throwing a cancellation', () => {
  it('lets a job that was not cancelled carry on', () => {
    expect(() => throwIfAborted(new AbortController().signal)).not.toThrow()
  })

  it('throws once the signal is aborted', () => {
    expect(() => throwIfAborted(aborted())).toThrow(CANCELLED_MESSAGE)
  })

  it('throws something the matcher recognises', () => {
    // The two halves are only a convention if they agree, which is the whole
    // reason they now live in one file.
    try {
      throwIfAborted(aborted())
      expect.unreachable('the aborted signal should have thrown')
    } catch (reason) {
      expect(isAbort(reason)).toBe(true)
    }
  })

  it('is the only module in lib/ that builds one', () => {
    const builders = libModules().filter((file) =>
      readFileSync(join(repoRoot, file), 'utf8').includes('new DOMException('),
    )

    expect(builders).toEqual([OWNER])
  })
})

describe('recognising one', () => {
  it('matches the plain Error a cancellation becomes after crossing the worker', () => {
    // Comlink cannot carry a DOMException back, so by the time the main thread
    // sees a cancel it is an ordinary Error wearing the name.
    const crossed = new Error(CANCELLED_MESSAGE)
    crossed.name = ABORT_ERROR_NAME

    expect(isAbort(crossed)).toBe(true)
  })

  it('matches what the worker rejects with', () => {
    expect(isAbort(new ConversionCancelledError())).toBe(true)
  })

  it('does not match pdf.js, which names its cancellation differently', () => {
    // pdf.js raises `AbortException`. Matching it would quietly exempt a
    // failure mode nobody has thought about, so a future `read` that renders
    // rather than parses has to come back here rather than inherit the answer.
    const pdfjs = new Error('Rendering cancelled.')
    pdfjs.name = 'AbortException'

    expect(isAbort(pdfjs)).toBe(false)
  })

  it('does not match an ordinary failure', () => {
    expect(isAbort(new Error('The document is damaged.'))).toBe(false)
    expect(isAbort(new TypeError('x is not a function'))).toBe(false)
  })

  it('does not match a value with no name at all', () => {
    expect(isAbort(null)).toBe(false)
    expect(isAbort(undefined)).toBe(false)
    expect(isAbort('AbortError')).toBe(false)
    expect(isAbort({})).toBe(false)
  })

  it('is the only module in lib/ that spells the name out', () => {
    // Stronger than "nobody else compares against it": nobody else says it.
    // A second literal is how the two halves stop agreeing, and prose counts —
    // a header that restates the rule is a second place to update.
    const namers = libModules().filter((file) =>
      readFileSync(join(repoRoot, file), 'utf8').includes("'AbortError'"),
    )

    expect(namers).toEqual([OWNER])
  })
})
