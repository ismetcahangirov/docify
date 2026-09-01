import { render, screen, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { RouteBadge } from '@/components/converter/route-badge'
import { descriptor as canvas } from '@/lib/engines/canvas'
import { descriptor as ffmpeg } from '@/lib/engines/ffmpeg'
import { route } from '@/lib/router/route'
import type { Capabilities, ConversionTask, Warning } from '@/lib/router/types'

import { COLOURS } from '../../support/tokens'

/*
 * The RouteBadge (issue #59): which engine was chosen, and why.
 *
 * The last two blocks drive the component from a real `route()` result rather
 * than from a hand-written prop object. That is the assertion that matters —
 * the badge exists to report the router's decision, and a fixture that agrees
 * with the component while disagreeing with the router would pass every test and
 * tell the user something untrue.
 */

const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const badge = () => screen.getByTestId('badge')
const pill = () =>
  screen.getByText((_, node) => node?.getAttribute('data-slot') === 'route-badge-pill')

const warning = (code: Warning['code'], message: string): Warning => ({ code, message })

describe('RouteBadge — what it shows', () => {
  it('names the engine in the words the engine names itself', () => {
    render(
      <RouteBadge
        data-testid="badge"
        engine="canvas"
        reason="Built into your browser"
        loadCost={0}
      />,
    )

    expect(screen.getByText('Built into your browser')).toBeInTheDocument()
  })

  it('carries the engine id for anything that has to be stable', () => {
    // A label is copy and will be rewritten; a bug report, a test and a future
    // analytics event all need the id.
    render(<RouteBadge data-testid="badge" engine="ffmpeg" reason="Universal fallback (ffmpeg)" />)

    expect(badge()).toHaveAttribute('data-engine', 'ffmpeg')
  })

  it('reads a zero download as the good news it is', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" loadCost={0} />)

    expect(within(badge()).getByText('No download')).toBeInTheDocument()
  })

  it('quotes a real download in the units someone on a phone cares about', () => {
    render(
      <RouteBadge
        data-testid="badge"
        engine="ffmpeg"
        reason="Fallback"
        loadCost={32 * 1024 * 1024}
      />,
    )

    expect(within(badge()).getByText('32 MB download')).toBeInTheDocument()
  })

  it('says something sensible when the cost was not passed at all', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" />)

    expect(within(badge()).getByText(/on your device/i)).toBeInTheDocument()
  })
})

describe('RouteBadge — the warnings', () => {
  it('shows nothing at all when there is nothing to say', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" loadCost={0} />)

    expect(within(badge()).queryByRole('list')).not.toBeInTheDocument()
  })

  it('reads every warning as text rather than hiding it behind a hover', () => {
    // A tooltip does not exist on a phone and does not exist to a screen reader
    // that was not told to look.
    render(
      <RouteBadge
        data-testid="badge"
        engine="ffmpeg"
        reason="Fallback"
        warnings={[
          warning('SLOW_PATH', 'This will take noticeably longer.'),
          warning('QUALITY_LOSS', 'Re-encoding gives up a little quality.'),
        ]}
      />,
    )

    const items = within(badge()).getAllByRole('listitem')
    expect(items).toHaveLength(2)
    expect(items[0]).toHaveTextContent('This will take noticeably longer.')
  })

  it('keeps the order the router produced, most consequential first', () => {
    render(
      <RouteBadge
        data-testid="badge"
        engine="ffmpeg"
        reason="Fallback"
        warnings={[
          warning('SLOW_PATH', 'Slow.'),
          warning('LARGE_DOWNLOAD', 'Big.'),
          warning('QUALITY_LOSS', 'Lossy.'),
        ]}
      />,
    )

    expect(
      within(badge())
        .getAllByRole('listitem')
        .map((item) => item.getAttribute('data-warning')),
    ).toEqual(['SLOW_PATH', 'LARGE_DOWNLOAD', 'QUALITY_LOSS'])
  })
})

describe('RouteBadge — driven by the router itself', () => {
  const jpgToPng: ConversionTask = { from: 'jpg', to: 'png', op: 'convert' }
  const mp4ToWebm: ConversionTask = { from: 'mp4', to: 'webm', op: 'convert' }

  /** Renders whatever `route()` decided, with nothing invented in between. */
  function renderDecision(task: ConversionTask, caps: Capabilities = desktop) {
    const decision = route(task, 4 * 1024 * 1024, caps)
    if (!decision.ok) throw new Error(`expected an engine, got ${decision.code}`)

    render(
      <RouteBadge
        data-testid="badge"
        engine={decision.engine}
        reason={decision.reason}
        loadCost={decision.loadCost}
        warnings={decision.warnings}
      />,
    )

    return decision
  }

  it('shows the free path as free', () => {
    const decision = renderDecision(jpgToPng)

    expect(decision.engine).toBe(canvas.id)
    expect(badge()).toHaveAttribute('data-engine', 'canvas')
    expect(within(badge()).getByText(canvas.label)).toBeInTheDocument()
    expect(within(badge()).getByText('No download')).toBeInTheDocument()
  })

  it('shows the expensive path with every reason it is expensive', () => {
    const decision = renderDecision(mp4ToWebm, { ...desktop, crossOriginIsolated: false })

    expect(decision.engine).toBe(ffmpeg.id)
    expect(within(badge()).getByText(ffmpeg.label)).toBeInTheDocument()
    // Whatever the router said, however many that turns out to be — the point is
    // that none of them is dropped on the floor.
    expect(within(badge()).getAllByRole('listitem')).toHaveLength(decision.warnings.length)
    expect(decision.warnings.length).toBeGreaterThan(0)
  })
})

describe('RouteBadge — the design contract', () => {
  it('paints itself only from the @theme palette', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" loadCost={0} />)

    const colours = [...pill().className.matchAll(/(?:bg|text|border)-([a-z0-9-]+)/g)].map(
      (match) => match[1],
    )

    for (const colour of colours) {
      if (colour === 'tech') continue

      expect(COLOURS.has(colour)).toBe(true)
    }
  })

  it('sets technical detail in the mono face the type scale gives it', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" loadCost={0} />)

    expect(pill().className).toContain('font-mono')
    expect(pill().className).toContain('text-tech')
  })

  it('is a flat pill with one border, and no shadow or blur', () => {
    render(<RouteBadge data-testid="badge" engine="canvas" reason="Built in" loadCost={0} />)

    expect(pill().className).toContain('rounded-full')
    expect(pill().className).not.toMatch(/shadow|backdrop-|ring-/)
  })

  it('cannot push its container sideways', () => {
    // An engine label is copy and a warning is a sentence; neither may set the
    // card's min-content width.
    render(
      <RouteBadge
        data-testid="badge"
        engine="ffmpeg"
        reason="Universal fallback (ffmpeg)"
        warnings={[warning('SLOW_PATH', 'A'.repeat(200))]}
      />,
    )

    expect(badge().className).toContain('min-w-0')
    expect(pill().className).toContain('break-words')
  })
})
