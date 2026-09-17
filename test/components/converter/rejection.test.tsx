import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Rejection } from '@/components/converter/rejection'
import type { ConversionTask, RejectionCode, RouteRejection } from '@/lib/router/types'

import { COLOURS } from '../../support/tokens'

/*
 * The rejection UI (issue #62).
 *
 * Three things have to be on screen every time: what went wrong, what to do
 * about it, and — where one exists — somewhere to go and do it. The first two
 * come off the `RouteRejection` unchanged; this component may not paraphrase
 * them, because the router is the only thing that knows the numbers in them.
 */

const rejection = (over: Partial<RouteRejection> = {}): RouteRejection => ({
  ok: false,
  code: 'UNSUPPORTED_PAIR',
  message: 'Converting HEIC to ICO is not something this browser can do here.',
  suggestion: 'Choose a different output format for your HEIC file.',
  overridable: false,
  ...over,
})

const task = (over: Partial<ConversionTask> = {}): ConversionTask => ({
  from: 'heic',
  to: 'ico',
  op: 'convert',
  ...over,
})

const panel = () => screen.getByRole('alert')

const slot = (name: string) => panel().querySelector(`[data-slot="${name}"]`)

describe('Rejection — the reason and the next step', () => {
  it('shows the router message verbatim', () => {
    render(<Rejection rejection={rejection()} />)

    expect(slot('rejection-message')?.textContent).toBe(rejection().message)
  })

  it('shows the router suggestion verbatim', () => {
    render(<Rejection rejection={rejection()} />)

    expect(slot('rejection-suggestion')?.textContent).toBe(rejection().suggestion)
  })

  it('names the kind of refusal in words, for every code', () => {
    const codes: RejectionCode[] = [
      'FILE_TOO_LARGE',
      'UNSUPPORTED_PAIR',
      'DEVICE_TOO_WEAK',
      'CODEC_UNAVAILABLE',
      'EMPTY_INPUT',
    ]

    for (const code of codes) {
      const { unmount } = render(<Rejection rejection={rejection({ code })} />)

      expect(slot('rejection-title')?.textContent).toMatch(/\S/)
      unmount()
    }
  })

  it('carries the code on the element, so the state is inspectable', () => {
    render(<Rejection rejection={rejection({ code: 'DEVICE_TOO_WEAK' })} />)

    expect(panel()).toHaveAttribute('data-code', 'DEVICE_TOO_WEAK')
  })

  /*
   * A refusal arrives after the user has already done something and is looking
   * at a file list, not at this block. `role="alert"` is what makes it reach
   * somebody who is not looking.
   */
  it('announces itself', () => {
    render(<Rejection rejection={rejection()} />)

    expect(panel()).toBeInTheDocument()
  })

  /*
   * `--color-err` on `--color-ink-2` measures 2.9:1, below AA for text. The
   * signal is a rule down the side; the words stay in the ordinary foreground.
   */
  it('does not put the failure into red text', () => {
    render(<Rejection rejection={rejection()} />)

    expect(slot('rejection-message')?.className).not.toMatch(/text-err/)
    expect(COLOURS.get('err')).toBe('#a83a2e')
  })
})

describe('Rejection — the alternative', () => {
  it('offers nothing when there is nothing to offer', () => {
    render(<Rejection rejection={rejection()} task={task()} alternatives={[]} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })

  it('links each alternative to the page that performs it', () => {
    render(
      <Rejection
        rejection={rejection()}
        task={task()}
        alternatives={[task({ to: 'jpg' }), task({ to: 'png' })]}
      />,
    )

    const links = within(panel()).getAllByRole('link')

    expect(links).toHaveLength(2)
    expect(links[0]).toHaveAttribute('href', '/convert/heic-to-jpg')
    expect(links[1]).toHaveAttribute('href', '/convert/heic-to-png')
  })

  it('names the target format in the link, not just "here"', () => {
    render(<Rejection rejection={rejection()} task={task()} alternatives={[task({ to: 'jpg' })]} />)

    expect(within(panel()).getByRole('link', { name: /JPG/ })).toBeInTheDocument()
  })

  /*
   * A converter page is cross-origin isolated and a soft navigation carries the
   * previous document's isolation with it (see next.config.ts). A rejection is a
   * rare path, so the whole-document load costs nothing and guarantees the
   * destination evaluates its own headers.
   */
  it('leaves the isolation boundary alone by loading the destination fully', () => {
    render(<Rejection rejection={rejection()} task={task()} alternatives={[task({ to: 'jpg' })]} />)

    expect(within(panel()).getByRole('link', { name: /JPG/ }).tagName).toBe('A')
  })

  it('says nothing about alternatives when it was not given a task', () => {
    render(<Rejection rejection={rejection()} alternatives={[task({ to: 'jpg' })]} />)

    expect(screen.queryByRole('link')).not.toBeInTheDocument()
  })
})

/*
 * The way through a refusal (issue #322).
 *
 * The memory budget is an estimate — five of the ten `MEMORY` rows are
 * unmeasured — and the home page promises no limit on file size. So a refusal
 * the router itself marks as an estimate carries a button, and one that is a
 * flat platform fact does not.
 */
describe('Rejection — the way through', () => {
  const tooLarge = (over: Partial<RouteRejection> = {}) =>
    rejection({
      code: 'FILE_TOO_LARGE',
      message:
        'This file is 2.1 GB. The largest MP4 file this device can convert safely is 300 MB.',
      suggestion: 'Split the file into smaller parts, or shrink it before converting.',
      overridable: true,
      ...over,
    })

  it('offers a way through a refusal the router marked overridable', () => {
    const onConvertAnyway = vi.fn()
    render(<Rejection rejection={tooLarge()} onConvertAnyway={onConvertAnyway} />)

    fireEvent.click(within(panel()).getByRole('button'))

    expect(onConvertAnyway).toHaveBeenCalledTimes(1)
  })

  it('offers nothing when the router says there is no way through', () => {
    // The bitmap ceiling: past it a canvas comes back blank rather than
    // throwing, so accepting the risk buys a silently wrong image.
    render(<Rejection rejection={tooLarge({ overridable: false })} onConvertAnyway={vi.fn()} />)

    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers nothing when the caller wired no handler', () => {
    render(<Rejection rejection={tooLarge()} />)

    expect(within(panel()).queryByRole('button')).not.toBeInTheDocument()
  })

  it('says what the risk is before it is taken', () => {
    render(<Rejection rejection={tooLarge()} onConvertAnyway={vi.fn()} />)

    expect(slot('rejection-override-note')).toBeInTheDocument()
  })

  it('takes an accessible name from the caller, so a list of cards is navigable', () => {
    render(
      <Rejection
        rejection={tooLarge()}
        onConvertAnyway={vi.fn()}
        overrideLabel="Convert holiday.mp4 anyway"
      />,
    )

    expect(
      within(panel()).getByRole('button', { name: 'Convert holiday.mp4 anyway' }),
    ).toBeInTheDocument()
  })

  it('leaves the words the router chose untouched', () => {
    render(<Rejection rejection={tooLarge()} onConvertAnyway={vi.fn()} />)

    expect(slot('rejection-message')?.textContent).toBe(tooLarge().message)
    expect(slot('rejection-suggestion')?.textContent).toBe(tooLarge().suggestion)
  })
})
