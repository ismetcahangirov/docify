import { fireEvent, render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { JOB_STATUS_LABELS, JobCard } from '@/components/converter/job-card'
import { createJob, type QueuedJob } from '@/lib/queue/queue'
import type { JobState } from '@/lib/queue/state'

import { COLOURS } from '../../support/tokens'

/*
 * The JobCard (issue #58): progress, an ETA, a cancel that works, and a failure
 * that says what to do next.
 *
 * The clock is passed in throughout. The card runs its own interval in a
 * browser, and a test that let it do so here would be asserting against
 * whatever the runner happened to schedule.
 */

const START = 1_700_000_000_000

const job = (over: Partial<QueuedJob> = {}): QueuedJob => ({
  ...createJob('a', new File(['x'.repeat(2048)], 'holiday clip.mov', { type: 'video/quicktime' })),
  ...over,
})

const card = () => screen.getByRole('article')

const slot = (name: string) => card().querySelector(`[data-slot="${name}"]`)

describe('JobCard — what it says about a job', () => {
  it('names the file and its size', () => {
    render(<JobCard job={job()} now={START} />)

    expect(screen.getByRole('heading', { name: 'holiday clip.mov' })).toBeInTheDocument()
    expect(slot('job-card-size')?.textContent).toBe('2 KB')
  })

  it('names the state in words for every one of the six', () => {
    const states: JobState[] = [
      'queued',
      'routing',
      'loading-engine',
      'processing',
      'done',
      'failed',
    ]

    for (const state of states) {
      const { unmount } = render(<JobCard job={job({ state })} now={START} />)

      expect(slot('job-card-state')?.textContent).toBe(JOB_STATUS_LABELS[state])
      expect(card()).toHaveAttribute('data-state', state)
      unmount()
    }
  })

  it('leaves announcing to the queue rather than being its own live region', () => {
    render(<JobCard job={job({ state: 'done' })} now={START} />)

    // The card is deliberately *not* a live region — `QueueAnnouncer` is the
    // one region for the whole queue (issue #63). A region per card competes
    // with every other card, and the countdown inside this line would make each
    // one re-announce itself once a second.
    expect(slot('job-card-status')).not.toHaveAttribute('aria-live')
  })

  it('gives the progress bar a name that says which file it belongs to', () => {
    render(<JobCard job={job({ state: 'processing', progress: 0.4 })} now={START} />)

    const bar = screen.getByRole('progressbar')
    expect(bar).toHaveAccessibleName('Converting holiday clip.mov')
    expect(bar).toHaveAttribute('aria-valuenow', '40')
  })

  it('shows no bar at all for a job that is not running', () => {
    for (const state of ['queued', 'done', 'failed'] as const) {
      const { unmount } = render(<JobCard job={job({ state })} now={START} />)

      expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
      unmount()
    }
  })

  it('shows an empty bar for an engine that cannot measure itself', () => {
    // `-1` is a real report and not an error: something is happening and cannot
    // say how far along. An empty track under "Converting" says that honestly.
    render(<JobCard job={job({ state: 'processing', progress: -1 })} now={START} />)

    expect(screen.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '0')
  })
})

describe('JobCard — the estimate', () => {
  it('counts down once there is something honest to say', () => {
    render(
      <JobCard
        job={job({ state: 'processing', progress: 0.25, startedAt: START })}
        now={START + 10_000}
      />,
    )

    expect(slot('job-card-eta')?.textContent).toBe('about 30 seconds left')
  })

  it('says nothing at all while the estimate would be noise', () => {
    render(
      <JobCard
        job={job({ state: 'processing', progress: 0.001, startedAt: START })}
        now={START + 200}
      />,
    )

    expect(slot('job-card-eta')).toBeNull()
  })

  it('says nothing about a job that is not converting yet', () => {
    // The engine is still downloading; there is no rate to extrapolate from.
    render(
      <JobCard
        job={job({ state: 'loading-engine', progress: 0.5, startedAt: START })}
        now={START + 10_000}
      />,
    )

    expect(slot('job-card-eta')).toBeNull()
  })
})

describe('JobCard — the routing decision', () => {
  it('shows which engine took it once one has', () => {
    render(
      <JobCard
        job={job({
          state: 'processing',
          engine: 'ffmpeg',
          reason: 'Universal fallback (ffmpeg)',
          warnings: [{ code: 'SLOW_PATH', message: 'This will take longer.' }],
        })}
        now={START}
      />,
    )

    expect(slot('route-badge')).toHaveAttribute('data-engine', 'ffmpeg')
    expect(within(card()).getByText('This will take longer.')).toBeInTheDocument()
  })

  it('shows nothing before the router has decided', () => {
    render(<JobCard job={job({ state: 'routing' })} now={START} />)

    expect(slot('route-badge')).toBeNull()
  })
})

describe('JobCard — when it fails', () => {
  const failed = job({
    state: 'failed',
    failure: {
      code: 'FILE_TOO_LARGE',
      message: 'This file is 800 MB, and this device can convert up to 400 MB at once.',
      suggestion: 'Try it on a desktop browser, or split the video first.',
    },
  })

  // A failure with a router code is drawn by `./rejection` (issue #62), so the
  // card is asserted on what reaches the screen rather than on which component
  // put it there.
  it('says what went wrong and what to do about it', () => {
    render(<JobCard job={failed} now={START} />)

    expect(slot('rejection-message')?.textContent).toMatch(/800 MB/)
    expect(slot('rejection-suggestion')?.textContent).toMatch(/split the video/)
  })

  it('offers the alternatives it was given, as links to the pages that run them', () => {
    render(
      <JobCard
        job={failed}
        task={{ from: 'heic', to: 'ico', op: 'convert' }}
        alternatives={[{ from: 'heic', to: 'jpg', op: 'convert' }]}
        now={START}
      />,
    )

    expect(screen.getByRole('link', { name: /HEIC to JPG/ })).toHaveAttribute(
      'href',
      '/convert/heic-to-jpg',
    )
  })

  it('does not lean on colour to say it has failed', () => {
    // `--color-err` on `--color-ink-2` measures 2.9:1, below AA for text and
    // below 3:1 for a meaningful icon. The words carry the meaning; the rule is
    // only an accent.
    render(<JobCard job={failed} now={START} />)

    expect(slot('rejection-message')?.className).not.toContain('text-err')
    expect(slot('job-card-state')?.textContent).toBe('Could not convert')
  })

  it('offers another go', () => {
    const onRetry = vi.fn()
    render(<JobCard job={failed} onRetry={onRetry} now={START} />)

    fireEvent.click(screen.getByRole('button', { name: /try converting .* again/i }))

    expect(onRetry).toHaveBeenCalledWith('a')
  })

  it('copes with an engine failure that had no advice to give', () => {
    // A router rejection always carries a suggestion; an engine that threw may
    // not, and the card must not render an empty paragraph for it.
    render(
      <JobCard job={job({ state: 'failed', failure: { message: 'It broke.' } })} now={START} />,
    )

    expect(slot('job-card-failure-suggestion')).toBeNull()
  })
})

describe('JobCard — the buttons', () => {
  it('cancels the job it belongs to, by name', () => {
    const onCancel = vi.fn()
    render(<JobCard job={job({ state: 'processing' })} onCancel={onCancel} now={START} />)

    // One card in a list of twenty, and "Cancel" on its own names none of them.
    fireEvent.click(screen.getByRole('button', { name: 'Cancel converting holiday clip.mov' }))

    expect(onCancel).toHaveBeenCalledWith('a')
  })

  it('offers cancel for every state where work is actually happening', () => {
    for (const state of ['routing', 'loading-engine', 'processing'] as const) {
      const { unmount } = render(<JobCard job={job({ state })} onCancel={vi.fn()} now={START} />)

      expect(screen.getByRole('button', { name: /^cancel/i })).toBeInTheDocument()
      unmount()
    }
  })

  it('offers it for none of the states where nothing is', () => {
    for (const state of ['queued', 'done', 'failed'] as const) {
      const { unmount } = render(<JobCard job={job({ state })} onCancel={vi.fn()} now={START} />)

      expect(screen.queryByRole('button', { name: /^cancel/i })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('hides a button it was given no handler for, rather than disabling it', () => {
    render(<JobCard job={job({ state: 'processing' })} now={START} />)

    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })

  it('offers a start on a cancelled job, which `queued` alone does not ask for', () => {
    // A cancelled job is `queued` with the file still in the list, and the
    // scheduler will not pick it up again on its own — so without this the card
    // says "Waiting" and offers nothing that moves it (issue #278).
    const onRetry = vi.fn()
    render(
      <JobCard job={job({ state: 'queued', cancelled: true })} onRetry={onRetry} now={START} />,
    )

    fireEvent.click(screen.getByRole('button', { name: 'Start converting holiday clip.mov' }))

    expect(onRetry).toHaveBeenCalledWith('a')
  })

  it('offers nothing to start on a job that is merely waiting its turn', () => {
    render(<JobCard job={job({ state: 'queued' })} onRetry={vi.fn()} now={START} />)

    expect(screen.queryByRole('button', { name: /^start/i })).not.toBeInTheDocument()
  })

  it('offers nothing to start once a cancelled job is running again', () => {
    // The mark outlives the click only until the job actually moves; a start
    // button beside a progress bar would be a second worker on one file.
    for (const state of ['routing', 'loading-engine', 'processing'] as const) {
      const { unmount } = render(
        <JobCard job={job({ state, cancelled: true })} onRetry={vi.fn()} now={START} />,
      )

      expect(screen.queryByRole('button', { name: /^start/i })).not.toBeInTheDocument()
      unmount()
    }
  })

  it('removes the file from the queue', () => {
    const onRemove = vi.fn()
    render(<JobCard job={job()} onRemove={onRemove} now={START} />)

    fireEvent.click(screen.getByRole('button', { name: /remove holiday clip.mov/i }))

    expect(onRemove).toHaveBeenCalledWith('a')
  })

  it('names the icon-only button, which has no text of its own', () => {
    render(<JobCard job={job()} onRemove={vi.fn()} now={START} />)

    expect(screen.getByRole('button')).toHaveAccessibleName(
      'Remove holiday clip.mov from the queue',
    )
  })
})

describe('JobCard — the design contract', () => {
  it('paints itself only from the @theme palette', () => {
    render(<JobCard job={job()} now={START} />)

    const colours = [...card().className.matchAll(/(?:bg|text|border)-([a-z0-9-]+)/g)].map(
      (match) => match[1],
    )

    for (const colour of colours) {
      if (colour === 'h3') continue

      expect(COLOURS.has(colour)).toBe(true)
    }
  })

  it('is a flat fill with one border, and no shadow or blur', () => {
    render(<JobCard job={job()} now={START} />)

    expect(card().className).toContain('rounded-lg')
    expect(card().className).not.toMatch(/shadow|backdrop-|ring-/)
  })

  it('cannot be pushed sideways by a file name with no spaces in it', () => {
    render(<JobCard job={job()} now={START} />)

    expect(card().className).toContain('min-w-0')
    // `break-all`, because a file name is often one unbroken token and a token
    // wider than the card is the card's min-content width.
    expect(slot('job-card-name')?.className).toContain('break-all')
  })
})
