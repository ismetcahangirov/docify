import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ResultPanel } from '@/components/converter/result-panel'
import { createJob, type QueuedJob } from '@/lib/queue/queue'

/*
 * The result panel (issue #61): every finished file, one link each, and one
 * archive for the lot.
 *
 * The object-URL bookkeeping is asserted here rather than left to a browser,
 * because it is the half nobody notices going wrong: a link that still works
 * after the file it pointed at was removed from the queue is a converted blob
 * the tab cannot free.
 */

const created: string[] = []
const revoked: string[] = []

beforeEach(() => {
  created.length = 0
  revoked.length = 0

  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: () => {
      const url = `blob:docify/${created.length}`
      created.push(url)

      return url
    },
    revokeObjectURL: (url: string) => revoked.push(url),
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const done = (id: string, name: string, bytes = 2048): QueuedJob => ({
  ...createJob(id, new File(['y'], name)),
  state: 'done',
  result: new Blob(['x'.repeat(bytes)], { type: 'image/jpeg' }),
})

const panel = () => screen.getByRole('region', { name: /result/i })

const links = () => within(panel()).getAllByRole('link')

describe('ResultPanel — when there is nothing to show', () => {
  it('renders nothing at all rather than an empty shell', () => {
    const { container } = render(<ResultPanel jobs={[]} to="jpg" />)

    expect(container).toBeEmptyDOMElement()
  })

  it('stays away while the only job is still running', () => {
    const running: QueuedJob = { ...createJob('a', new File(['y'], 'a.heic')), state: 'processing' }
    const { container } = render(<ResultPanel jobs={[running]} to="jpg" />)

    expect(container).toBeEmptyDOMElement()
  })
})

describe('ResultPanel — individual downloads', () => {
  it('gives every finished file its own download link, named for the result', () => {
    render(<ResultPanel jobs={[done('a', 'IMG_1.HEIC'), done('b', 'IMG_2.HEIC')]} to="jpg" />)

    const [first, second] = links()

    expect(first).toHaveAttribute('download', 'IMG_1.jpg')
    expect(second).toHaveAttribute('download', 'IMG_2.jpg')
    expect(first).toHaveAttribute('href', created[0])
  })

  it('says how big each result is', () => {
    render(<ResultPanel jobs={[done('a', 'IMG_1.HEIC', 2048)]} to="jpg" />)

    expect(within(panel()).getByText('2 KB')).toBeInTheDocument()
  })

  it('counts the files and their weight in the heading area', () => {
    render(<ResultPanel jobs={[done('a', 'a.heic', 1024), done('b', 'b.heic', 1024)]} to="jpg" />)

    expect(within(panel()).getByText(/2 files/i)).toBeInTheDocument()
  })
})

describe('ResultPanel — the batch archive', () => {
  it('offers no archive for a single file, which is already one download', () => {
    render(<ResultPanel jobs={[done('a', 'a.heic')]} to="jpg" />)

    expect(screen.queryByRole('button', { name: /zip/i })).not.toBeInTheDocument()
  })

  it('offers one for several, and packs exactly what is listed', async () => {
    const onDownloadAll = vi.fn()
    render(
      <ResultPanel
        jobs={[done('a', 'scan.heic'), done('b', 'scan.heic')]}
        to="jpg"
        onDownloadAll={onDownloadAll}
      />,
    )

    fireEvent.click(screen.getByRole('button', { name: /zip/i }))

    expect(onDownloadAll).toHaveBeenCalledOnce()
    expect(onDownloadAll.mock.calls[0][0].map((r: { name: string }) => r.name)).toEqual([
      'scan.jpg',
      'scan-2.jpg',
    ])
  })
})

describe('ResultPanel — object URLs', () => {
  it('revokes every URL it made when the panel goes away', () => {
    const { unmount } = render(
      <ResultPanel jobs={[done('a', 'a.heic'), done('b', 'b.heic')]} to="jpg" />,
    )

    expect(created).toHaveLength(2)
    expect(revoked).toEqual([])

    unmount()
    expect(revoked.sort()).toEqual([...created].sort())
  })

  it('revokes the URL of a result that leaves the queue, and keeps the rest', () => {
    const a = done('a', 'a.heic')
    const b = done('b', 'b.heic')
    const { rerender } = render(<ResultPanel jobs={[a, b]} to="jpg" />)

    rerender(<ResultPanel jobs={[a]} to="jpg" />)

    expect(revoked).toEqual([created[1]])
    expect(links()[0]).toHaveAttribute('href', created[0])
  })

  it('does not mint a second URL for a result that has not changed', () => {
    const a = done('a', 'a.heic')
    const { rerender } = render(<ResultPanel jobs={[a]} to="jpg" />)

    rerender(<ResultPanel jobs={[a]} to="jpg" />)

    expect(created).toHaveLength(1)
    expect(revoked).toEqual([])
  })
})
