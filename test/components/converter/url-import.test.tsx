import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { UrlImport } from '@/components/converter/url-import'

/*
 * "Or paste a link to a file" (issue #270).
 *
 * The module under test is the form, so `lib/import/url` is mocked here and
 * asserted on its own in `test/lib/import-url.test.ts`. What is left for this
 * file is the part a user can see: whether the control is offered at all,
 * whether a fetched file reaches the queue, whether a failure is said out loud,
 * and whether the field can be used twice.
 */

const importFromUrl = vi.hoisted(() => vi.fn())
const isUrlImportConfigured = vi.hoisted(() => vi.fn(() => true))

vi.mock('@/lib/import/url', () => ({ importFromUrl, isUrlImportConfigured }))

const field = () => screen.getByLabelText(/paste a link/i)
const fetchButton = () => screen.getByRole('button', { name: /fetch/i })

/** Types a URL and submits, the way a person would. */
function ask(url: string) {
  fireEvent.change(field(), { target: { value: url } })
  fireEvent.click(fetchButton())
}

beforeEach(() => {
  isUrlImportConfigured.mockReturnValue(true)
  importFromUrl.mockReset()
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('the URL import form', () => {
  it('renders nothing at all where no proxy is configured', () => {
    isUrlImportConfigured.mockReturnValue(false)

    const { container } = render(<UrlImport onFile={vi.fn()} />)

    // Not a disabled control and not an explanation: a fork with no proxy is a
    // normal Docify, and a dead field would be the only broken thing on it.
    expect(container).toBeEmptyDOMElement()
  })

  it('hands the fetched file to the queue', async () => {
    const file = new File(['bytes'], 'photo.heic', { type: 'image/heic' })
    importFromUrl.mockResolvedValue(file)
    const onFile = vi.fn()

    render(<UrlImport onFile={onFile} />)
    ask('https://example.com/photo.heic')

    await waitFor(() => expect(onFile).toHaveBeenCalledWith(file))
    expect(importFromUrl).toHaveBeenCalledWith(
      'https://example.com/photo.heic',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    )
  })

  it('clears the field on success, so the next link starts from empty', async () => {
    importFromUrl.mockResolvedValue(new File(['bytes'], 'a.heic'))

    render(<UrlImport onFile={vi.fn()} />)
    ask('https://example.com/a.heic')

    await waitFor(() => expect(field()).toHaveValue(''))
  })

  it('says what went wrong, where a screen reader will hear it', async () => {
    importFromUrl.mockRejectedValue(new Error('This URL cannot be fetched: address.'))

    render(<UrlImport onFile={vi.fn()} />)
    ask('http://10.0.0.1/x')

    const said = await screen.findByRole('status')

    expect(said).toHaveTextContent('This URL cannot be fetched: address.')
    // The field keeps its value on failure: the URL is probably nearly right,
    // and clearing it would make the person type it again to find out.
    expect(field()).toHaveValue('http://10.0.0.1/x')
  })

  it('marks the field invalid while the message stands, and clears both on the next keystroke', async () => {
    importFromUrl.mockRejectedValue(new Error('That link could not be fetched (404).'))

    render(<UrlImport onFile={vi.fn()} />)
    ask('https://example.com/missing')

    await waitFor(() => expect(field()).toHaveAttribute('aria-invalid', 'true'))

    fireEvent.change(field(), { target: { value: 'https://example.com/there' } })

    expect(field()).not.toHaveAttribute('aria-invalid')
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('does not ask twice while one fetch is in flight', async () => {
    importFromUrl.mockImplementation(() => new Promise(() => {}))

    render(<UrlImport onFile={vi.fn()} />)
    ask('https://example.com/a.heic')

    await waitFor(() => expect(fetchButton()).toBeDisabled())

    fireEvent.click(fetchButton())

    expect(importFromUrl).toHaveBeenCalledTimes(1)
  })

  it('refuses an empty field without calling anything', () => {
    render(<UrlImport onFile={vi.fn()} />)

    fireEvent.click(fetchButton())

    expect(importFromUrl).not.toHaveBeenCalled()
  })

  it('says nothing when the import was cancelled', async () => {
    // Which is what unmounting does. A message about a fetch the person
    // themselves abandoned is noise, and by then they are not looking.
    importFromUrl.mockRejectedValue(
      Object.assign(new Error('The conversion was cancelled.'), { name: 'AbortError' }),
    )

    render(<UrlImport onFile={vi.fn()} />)
    ask('https://example.com/a.heic')

    await waitFor(() => expect(fetchButton()).not.toBeDisabled())
    expect(screen.getByRole('status')).toHaveTextContent('')
  })

  it('aborts the import in flight when it goes away', async () => {
    let handed: AbortSignal | undefined
    importFromUrl.mockImplementation(
      (_url: string, options: { signal: AbortSignal }) =>
        new Promise(() => {
          handed = options.signal
        }),
    )

    const { unmount } = render(<UrlImport onFile={vi.fn()} />)
    ask('https://example.com/a.heic')

    await waitFor(() => expect(handed).toBeDefined())
    unmount()

    expect(handed?.aborted).toBe(true)
  })

  it('gives the field a touch target the responsive contract allows', () => {
    render(<UrlImport onFile={vi.fn()} />)

    // 44px, the floor the whole app is held to. Asserted on the class because
    // jsdom lays nothing out; the e2e sweep measures the rendered box.
    expect(field().className).toContain('min-h-11')
  })
})
