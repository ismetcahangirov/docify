import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { Dropzone } from '@/components/converter/dropzone'

import { COLOURS, RADII, TYPE_SCALE } from '../../support/tokens'

/*
 * The dropzone (issue #56): drag and drop, click to browse, clipboard paste,
 * and more than one file at a time.
 *
 * Two notes on how this is asserted.
 *
 * jsdom has no `DataTransfer` constructor, so every drag and paste fixture is
 * the shape the component reads rather than a real transfer object. What is
 * under test is the component's behaviour on that shape — which files it takes,
 * when it highlights, what it calls back with — and not the browser's assembly
 * of the event.
 *
 * The palette assertions read app/globals.css through test/support/tokens.ts
 * instead of naming hex values, for the reason the CapabilityStrip suite gives:
 * a transcribed colour keeps agreeing with itself after the token behind it is
 * renamed, at which point the component compiles to no colour at all.
 */

const file = (name: string, type = 'video/mp4') => new File(['x'], name, { type })

const item = (value: File) => ({
  kind: 'file',
  getAsFile: () => value,
  webkitGetAsEntry: () => ({ isDirectory: false }),
})

/** A `DataTransfer` as the component reads one. */
const transfer = (files: File[]) => ({
  items: files.map(item),
  files,
  dropEffect: 'none',
})

const zone = () => screen.getByTestId('zone')

function renderZone(props: Partial<React.ComponentProps<typeof Dropzone>> = {}) {
  const onFiles = vi.fn()
  render(<Dropzone data-testid="zone" onFiles={onFiles} {...props} />)

  return onFiles
}

describe('Dropzone — the three ways in', () => {
  it('takes a dropped file', () => {
    const onFiles = renderZone()
    const dropped = file('holiday.mov')

    fireEvent.drop(zone(), { dataTransfer: transfer([dropped]) })

    expect(onFiles).toHaveBeenCalledWith([dropped])
  })

  it('takes several dropped files at once, in the order they arrived', () => {
    const onFiles = renderZone()
    const files = [file('a.mp4'), file('b.mov'), file('c.mkv')]

    fireEvent.drop(zone(), { dataTransfer: transfer(files) })

    expect(onFiles).toHaveBeenCalledWith(files)
  })

  it('takes a file chosen from the picker', () => {
    const onFiles = renderZone()
    const chosen = file('report.pdf', 'application/pdf')

    fireEvent.change(input(), { target: { files: [chosen] } })

    expect(onFiles).toHaveBeenCalledWith([chosen])
  })

  it('takes a pasted file', () => {
    const onFiles = renderZone()
    const pasted = file('screenshot.png', 'image/png')

    paste(document.body, [pasted])

    expect(onFiles).toHaveBeenCalledWith([pasted])
  })

  it('ignores a paste into something the user is typing in', () => {
    const onFiles = renderZone()
    const field = document.createElement('input')
    document.body.append(field)

    paste(field, [file('a.mp4')])

    expect(onFiles).not.toHaveBeenCalled()
    field.remove()
  })

  it('ignores a paste that carried no file', () => {
    const onFiles = renderZone()

    paste(document.body, [])

    expect(onFiles).not.toHaveBeenCalled()
  })

  it('stops listening for pastes once it is gone', () => {
    const onFiles = vi.fn()
    const { unmount } = render(<Dropzone data-testid="zone" onFiles={onFiles} />)

    unmount()
    paste(document.body, [file('a.mp4')])

    expect(onFiles).not.toHaveBeenCalled()
  })
})

describe('Dropzone — what it refuses', () => {
  it('says nothing at all when a drag carried no files', () => {
    const onFiles = renderZone()

    fireEvent.drop(zone(), { dataTransfer: { items: [], files: [] } })

    // Not a call with an empty list: the callback means "here are files".
    expect(onFiles).not.toHaveBeenCalled()
  })

  it('takes only the first when the zone is single-file', () => {
    const onFiles = renderZone({ multiple: false })
    const first = file('a.mp4')

    fireEvent.drop(zone(), { dataTransfer: transfer([first, file('b.mp4')]) })

    expect(onFiles).toHaveBeenCalledWith([first])
  })

  it('accepts nothing at all while disabled', () => {
    const onFiles = renderZone({ disabled: true })

    fireEvent.drop(zone(), { dataTransfer: transfer([file('a.mp4')]) })
    paste(document.body, [file('b.mp4')])

    expect(onFiles).not.toHaveBeenCalled()
    expect(input()).toBeDisabled()
  })
})

describe('Dropzone — the drag state', () => {
  it('highlights while a file is over it', () => {
    renderZone()

    expect(zone()).toHaveAttribute('data-dragging', 'false')
    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    expect(zone()).toHaveAttribute('data-dragging', 'true')
  })

  it('holds the highlight while the pointer crosses a child', () => {
    // `dragleave` fires on every child boundary, so a boolean flickers off and
    // on as the cursor moves over the icon inside the zone.
    renderZone()

    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    fireEvent.dragLeave(zone())

    expect(zone()).toHaveAttribute('data-dragging', 'true')
  })

  it('drops the highlight once the drag has really left', () => {
    renderZone()

    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    fireEvent.dragLeave(zone())

    expect(zone()).toHaveAttribute('data-dragging', 'false')
  })

  it('drops it on a drop, however deep the counter had got', () => {
    renderZone()

    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    fireEvent.dragEnter(zone(), { dataTransfer: transfer([]) })
    fireEvent.drop(zone(), { dataTransfer: transfer([file('a.mp4')]) })

    expect(zone()).toHaveAttribute('data-dragging', 'false')
  })

  it('claims the drag so the browser does not navigate away from the page', () => {
    // Without a prevented `dragover` the browser opens the dropped file and
    // takes the queue with it.
    renderZone()

    const event = new Event('dragover', { bubbles: true, cancelable: true })
    Object.defineProperty(event, 'dataTransfer', { value: { dropEffect: 'none' } })
    fireEvent(zone(), event)

    expect(event.defaultPrevented).toBe(true)
  })
})

describe('Dropzone — reachable without a mouse', () => {
  it('names the input with the zone label, so the picker is announced', () => {
    renderZone({ label: 'Drop a video here' })

    expect(screen.getByLabelText('Drop a video here')).toBe(input())
  })

  it('keeps the input focusable rather than hiding it from the keyboard', () => {
    // `hidden` would take Tab and Enter with it, and with them the only way to
    // open the picker without a pointer.
    renderZone()

    expect(input().className).toContain('sr-only')
    expect(input()).not.toHaveAttribute('hidden')
  })

  it('describes the input with the hint underneath it', () => {
    renderZone({ hint: 'MP4, MOV and MKV, up to 400 MB.' })

    expect(input()).toHaveAccessibleDescription('MP4, MOV and MKV, up to 400 MB.')
  })

  it('lets the same file be chosen twice in a row', () => {
    // The input keeps its value otherwise, and a second pick of the same file
    // fires no change event at all.
    const onFiles = renderZone()
    const chosen = file('a.mp4')

    fireEvent.change(input(), { target: { files: [chosen] } })

    expect(input().value).toBe('')
    expect(onFiles).toHaveBeenCalledTimes(1)
  })

  it('draws a focus ring rather than removing the outline', () => {
    renderZone()

    expect(zone().className).toContain('focus-within:outline-2')
    expect(zone().className).not.toContain('outline-none')
  })
})

describe('Dropzone — the design contract', () => {
  it('paints itself only from the @theme palette', () => {
    renderZone()

    const colours = [...zone().className.matchAll(/(?:bg|text|border)-([a-z0-9-]+)/g)].map(
      (match) => match[1],
    )

    for (const colour of colours) {
      // `current` inherits, and the type scale shares the `text-` prefix with
      // the palette without being part of it.
      if (colour === 'current' || colour === 'center') continue
      if (TYPE_SCALE.includes(colour)) continue

      expect(COLOURS.has(colour)).toBe(true)
    }
  })

  it('uses a radius step and not an arbitrary value', () => {
    renderZone()

    expect(RADII).toContain('lg')
    expect(zone().className).toContain('rounded-lg')
    expect(zone().className).not.toMatch(/rounded-\[/)
  })

  it('is a flat fill with one border, and no shadow or blur', () => {
    renderZone()

    expect(zone().className).not.toMatch(/shadow|backdrop-|ring-/)
  })

  it('cannot push its container sideways', () => {
    // A long file name or a wide hint must wrap rather than set the zone's
    // min-content width, which is the horizontal scroll the contract forbids.
    renderZone()

    expect(zone().className).toContain('min-w-0')
    expect(zone().className).toContain('break-words')
    expect(zone().className).toContain('w-full')
  })
})

/** The file input behind the zone. */
function input(): HTMLInputElement {
  const found = document.querySelector<HTMLInputElement>('[data-slot="dropzone-input"]')
  if (found === null) throw new Error('the dropzone rendered no file input')

  return found
}

/** A paste of `files` at `target`, as the document listener receives it. */
function paste(target: Element, files: File[]): void {
  const event = new Event('paste', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'clipboardData', { value: transfer(files) })
  target.dispatchEvent(event)
}
