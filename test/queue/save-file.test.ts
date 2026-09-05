/**
 * Handing a blob to the browser's downloader (issue #61).
 *
 * The acceptance criterion the issue is explicit about lives here: an object URL
 * is a document-lifetime reference to the whole blob, so one that is not revoked
 * pins a converted file in memory until the tab closes. A batch of a hundred is
 * how a converter ends up holding a gigabyte it finished with minutes ago.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { saveBlob } from '@/lib/queue/save-file'

const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  created.length = 0
  revoked.length = 0
  vi.useFakeTimers()

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: (blob: Blob) => {
      const url = `blob:docify/${created.length}#${blob.size}`
      created.push(url)

      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

describe('saveBlob', () => {
  it('clicks an anchor carrying the download name', () => {
    const clicked: HTMLAnchorElement[] = []
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      clicked.push(this)
    })

    saveBlob(new Blob(['x']), 'holiday.jpg')

    expect(click).toHaveBeenCalledOnce()
    expect(clicked[0]?.download).toBe('holiday.jpg')
    expect(clicked[0]?.href).toBe(created[0])
  })

  it('leaves nothing behind in the document', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    saveBlob(new Blob(['x']), 'holiday.jpg')

    expect(document.querySelectorAll('a')).toHaveLength(0)
  })

  /*
   * Not revoked in the same task as the click: a browser reads the href when the
   * download starts, which is after the current task has finished, and revoking
   * first cancels the download that was just asked for.
   */
  it('revokes the URL, but only once the download has had its turn', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    saveBlob(new Blob(['x']), 'holiday.jpg')
    expect(revoked).toEqual([])

    vi.runAllTimers()
    expect(revoked).toEqual([created[0]])
  })

  /*
   * A zero-delay macrotask is enough for Chromium and is not enough for Firefox
   * or Safari, which can still be reading the blob a second or two after the
   * click on a large file — and a URL revoked under them produces no file and
   * no error (issue #272). Ten seconds costs nothing: the blob is resident
   * either way, and this only decides when it stops being.
   */
  it('holds the URL for ten seconds, which is longer than any browser takes to start', () => {
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})

    saveBlob(new Blob(['x']), 'holiday.jpg')

    vi.advanceTimersByTime(9_999)
    expect(revoked).toEqual([])

    vi.advanceTimersByTime(1)
    expect(revoked).toEqual([created[0]])

    // Once, not once per timer that happens to fire afterwards.
    vi.advanceTimersByTime(60_000)
    expect(revoked).toEqual([created[0]])
  })
})
