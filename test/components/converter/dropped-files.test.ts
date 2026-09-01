import { describe, expect, it } from 'vitest'

import {
  acceptedFiles,
  filesFromTransfer,
  isTypingTarget,
} from '@/components/converter/dropped-files'

/*
 * The awkward half of a drop, tested without rendering anything.
 *
 * jsdom builds no `DataTransfer` — the constructor exists in browsers only — so
 * every fixture here is the shape the reader actually consults rather than a
 * real one. That is the right level: what is being asserted is which entries are
 * taken and which are left, not that the browser assembles the object.
 */

const file = (name: string, type = 'video/mp4') => new File(['x'], name, { type })

type Entry = { isDirectory: boolean } | null

interface FakeItem {
  kind: string
  getAsFile: () => File | null
  webkitGetAsEntry?: () => Entry
}

/** A `DataTransfer` as the reader sees it: an items list and a files list. */
function transfer(items: FakeItem[], files: File[] = []): DataTransfer {
  return { items, files } as unknown as DataTransfer
}

const fileItem = (value: File, entry: Entry = { isDirectory: false }): FakeItem => ({
  kind: 'file',
  getAsFile: () => value,
  webkitGetAsEntry: () => entry,
})

describe('filesFromTransfer', () => {
  it('takes the files, in the order they were offered', () => {
    const first = file('a.mp4')
    const second = file('b.mov')

    expect(filesFromTransfer(transfer([fileItem(first), fileItem(second)]))).toEqual([
      first,
      second,
    ])
  })

  it('leaves a dropped folder behind', () => {
    // The most common mistake there is. A folder arrives with no type and no
    // readable content, so accepting it means failing deep inside an engine
    // with a message about a damaged file.
    const folder = fileItem(file('holiday', ''), { isDirectory: true })

    expect(filesFromTransfer(transfer([folder, fileItem(file('a.mp4'))]))).toHaveLength(1)
  })

  it('ignores the text a paste carries alongside a file', () => {
    const text: FakeItem = { kind: 'string', getAsFile: () => null }

    expect(filesFromTransfer(transfer([text, fileItem(file('a.mp4'))]))).toHaveLength(1)
  })

  it('answers nothing for a drag that carried no files at all', () => {
    const link: FakeItem = { kind: 'string', getAsFile: () => null }

    expect(filesFromTransfer(transfer([link]))).toEqual([])
  })

  it('falls back to the files list where there is no items list', () => {
    // Accepting one thing it should not is the honest failure here; accepting
    // nothing would break the drop entirely on a browser without the API.
    const only = file('a.mp4')

    expect(filesFromTransfer(transfer([], [only]))).toEqual([only])
  })

  it('reads an item whose browser has no entry API at all', () => {
    const only = file('a.mp4')
    const bare: FakeItem = { kind: 'file', getAsFile: () => only }

    expect(filesFromTransfer(transfer([bare]))).toEqual([only])
  })

  it('answers nothing rather than throwing when there is no transfer', () => {
    expect(filesFromTransfer(null)).toEqual([])
    expect(filesFromTransfer(undefined)).toEqual([])
  })
})

describe('isTypingTarget', () => {
  it('recognises the controls a paste belongs to', () => {
    for (const tag of ['input', 'textarea', 'select']) {
      expect(isTypingTarget(document.createElement(tag))).toBe(true)
    }
  })

  it('recognises a rich text editor', () => {
    const editor = document.createElement('div')
    // jsdom does not derive `isContentEditable` from the attribute.
    Object.defineProperty(editor, 'isContentEditable', { value: true })

    expect(isTypingTarget(editor)).toBe(true)
  })

  it('lets a paste onto the page itself through', () => {
    expect(isTypingTarget(document.createElement('div'))).toBe(false)
    expect(isTypingTarget(null)).toBe(false)
  })
})

describe('acceptedFiles', () => {
  it('takes everything when several are allowed', () => {
    const files = [file('a.mp4'), file('b.mp4'), file('c.mp4')]

    expect(acceptedFiles(files, true)).toEqual(files)
  })

  it('takes the first rather than refusing all of them', () => {
    // The user's intent is not in doubt, and an error that says "one at a time"
    // after a drop they have to repeat is a worse answer.
    const first = file('a.mp4')

    expect(acceptedFiles([first, file('b.mp4')], false)).toEqual([first])
  })

  it('takes nothing from nothing', () => {
    expect(acceptedFiles([], true)).toEqual([])
  })
})
