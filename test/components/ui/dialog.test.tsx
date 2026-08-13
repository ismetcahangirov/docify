import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'

function renderDialog(contentProps: { showCloseButton?: boolean } = {}) {
  return render(
    <Dialog>
      <DialogTrigger>Open settings</DialogTrigger>
      <DialogContent {...contentProps}>
        <DialogHeader>
          <DialogTitle>Discard this job?</DialogTitle>
          <DialogDescription>The converted file has not been downloaded yet.</DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <button type="button">Discard</button>
        </DialogFooter>
      </DialogContent>
    </Dialog>,
  )
}

describe('Dialog', () => {
  it('stays closed until the trigger is activated', () => {
    renderDialog()

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('dialog')).toBeInTheDocument()
  })

  it('labels and describes itself from the title and description', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    const dialog = screen.getByRole('dialog', { name: 'Discard this job?' })

    expect(dialog).toHaveAccessibleDescription('The converted file has not been downloaded yet.')
  })

  it('closes on Escape', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('closes when the close control is activated', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('gives the close control an accessible name', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument()
  })

  it('renders the panel as a flat dark surface with a 1px token border', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const className = screen.getByRole('dialog').className

    expect(className).toContain('bg-ink-2')
    expect(className).toContain('border-line-dark')
    expect(className).toContain('rounded-lg')
    expect(className).not.toMatch(/\bshadow(-|\b)/)
    expect(className).not.toMatch(/\bring-/)
  })

  // Regression guard for the `text-` ambiguity that `cn` resolves: the panel
  // sets both a type scale step and a colour, and neither may swallow the other.
  it('keeps the body type step alongside the body colour', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const className = screen.getByRole('dialog').className

    expect(className).toContain('text-body')
    expect(className).toContain('text-fg-dark')
  })

  it('darkens the backdrop without blurring it', () => {
    const { baseElement } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    const overlay = baseElement.querySelector('[data-slot="dialog-overlay"]')

    expect(overlay).not.toBeNull()
    // The scrim tone is the claim being made, so assert it exactly: a bare
    // `toContain('bg-ink')` also passes for the opaque `bg-ink-2`.
    expect(overlay?.className).toMatch(/\bbg-ink\/80\b/)
    expect(overlay?.className).not.toContain('backdrop-blur')
  })

  it('styles the title from the project type scale, not a shadcn default', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))
    const className = screen.getByText('Discard this job?').className

    expect(className).toContain('text-h3')
    expect(className).not.toContain('text-foreground')
  })

  it('mutes the description with the dark-surface muted token', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByText('The converted file has not been downloaded yet.').className).toContain(
      'text-fg-dark-mut',
    )
  })

  it('hides the close control when the caller opts out', () => {
    renderDialog({ showCloseButton: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
  })

  /*
   * The close button is positioned against the panel. If the panel is also the
   * scroll container, "top-3" is 3px from the *scrolled* origin — so with long
   * content the only pointer affordance for closing scrolls out of sight.
   * Scrolling the body instead keeps it anchored.
   *
   * jsdom has no layout engine, so this asserts the structure that makes the
   * behaviour possible rather than the geometry itself.
   */
  it('scrolls its body rather than the panel, so the close control stays put', () => {
    const { baseElement } = renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    const panel = screen.getByRole('dialog')
    const body = baseElement.querySelector('[data-slot="dialog-body"]')

    expect(panel.className).not.toContain('overflow-y-auto')
    expect(body?.className).toContain('overflow-y-auto')
    expect(body?.contains(screen.getByText('Discard this job?'))).toBe(true)
    expect(body?.contains(screen.getByRole('button', { name: 'Close' }))).toBe(false)
  })

  it('reserves room for the close control only when it is shown', () => {
    const { baseElement } = renderDialog({ showCloseButton: false })
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    expect(screen.getByRole('dialog')).not.toHaveAttribute('data-close-button')

    const header = baseElement.querySelector('[data-slot="dialog-header"]')

    // The reservation is conditional on the attribute, never unconditional.
    expect(header?.className).not.toMatch(/(?:^|\s)pr-\d/)
    expect(header?.className).toContain('group-data-[close-button]/dialog:pr-14')
  })

  it('never scrolls horizontally on a 320px viewport', () => {
    renderDialog()
    fireEvent.click(screen.getByRole('button', { name: 'Open settings' }))

    // The panel is capped by the viewport minus the gutter, so a narrow screen
    // shrinks it instead of pushing the page sideways.
    expect(screen.getByRole('dialog').className).toContain('w-[calc(100%-2rem)]')
  })
})
