import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import { Dropzone } from '@/components/converter/dropzone'
import { JobCard } from '@/components/converter/job-card'
import { Rejection } from '@/components/converter/rejection'
import { ResultPanel } from '@/components/converter/result-panel'
import { SettingsPanel } from '@/components/converter/settings-panel'
import { VIDEO_COMPRESSION_SCHEMA } from '@/lib/settings/video'
import { createJob, type QueuedJob } from '@/lib/queue/queue'

/*
 * Keyboard operability across the converter flow (issue #63).
 *
 * Two halves, and they catch different mistakes.
 *
 * The rendered half asserts the property a keyboard user actually depends on:
 * every control the flow puts on screen is reachable by Tab, in document order,
 * and announces something specific when it gets there. "Cancel" on the fourth of
 * twenty cards is reachable and useless.
 *
 * The source half is a scan, because the violation that matters is the one no
 * test happens to render: a `tabIndex={2}` in a variant, an `outline-none` on a
 * state nobody exercised. A rendered test can only fail on what it drew.
 */

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const converterDir = join(repoRoot, 'components', 'converter')

const done = (id: string, name: string): QueuedJob => ({
  ...createJob(id, new File(['x'], name)),
  state: 'done',
  result: new Blob(['y'], { type: 'image/jpeg' }),
})

/** Everything a Tab press can land on, in the order Tab would reach it. */
function focusables(root: HTMLElement): HTMLElement[] {
  return [
    ...root.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
    ),
  ]
}

/** The name a screen reader would read for `element`, however it is provided. */
function accessibleName(element: HTMLElement): string {
  const label = element.getAttribute('aria-label')
  if (label !== null) return label.trim()

  const labelledBy = element.getAttribute('aria-labelledby')
  if (labelledBy !== null) {
    return (document.getElementById(labelledBy)?.textContent ?? '').trim()
  }

  const owning = element.closest('label')
  if (owning !== null) return (owning.textContent ?? '').trim()

  // A label naming the control from elsewhere in the tree, which is how a
  // visually-hidden file input gets its name from the zone around it.
  if (element.id !== '') {
    const pointing = document.querySelector(`label[for="${element.id}"]`)
    if (pointing !== null) return (pointing.textContent ?? '').trim()
  }

  return (element.textContent ?? '').trim()
}

describe('every control the flow renders has a name', () => {
  const cases: Array<[string, React.ReactElement]> = [
    ['Dropzone', <Dropzone key="d" onFiles={() => {}} />],
    [
      'JobCard, running',
      <JobCard
        key="r"
        job={{ ...createJob('a', new File(['x'], 'beach.heic')), state: 'processing' }}
        onCancel={() => {}}
        onRemove={() => {}}
        now={0}
      />,
    ],
    [
      'JobCard, cancelled',
      <JobCard
        key="c"
        job={{ ...createJob('a', new File(['x'], 'beach.heic')), state: 'queued', cancelled: true }}
        onRetry={() => {}}
        onRemove={() => {}}
        now={0}
      />,
    ],
    [
      'JobCard, failed',
      <JobCard
        key="f"
        job={{
          ...createJob('a', new File(['x'], 'beach.heic')),
          state: 'failed',
          failure: { code: 'UNSUPPORTED_PAIR', message: 'No.', suggestion: 'Try PNG.' },
        }}
        task={{ from: 'heic', to: 'ico', op: 'convert' }}
        alternatives={[{ from: 'heic', to: 'png', op: 'convert' }]}
        onRetry={() => {}}
        onRemove={() => {}}
        now={0}
      />,
    ],
    [
      'Rejection',
      <Rejection
        key="j"
        rejection={{ ok: false, code: 'UNSUPPORTED_PAIR', message: 'No.', suggestion: 'Try PNG.' }}
        task={{ from: 'heic', to: 'ico', op: 'convert' }}
        alternatives={[{ from: 'heic', to: 'png', op: 'convert' }]}
      />,
    ],
    [
      'ResultPanel',
      <ResultPanel key="p" jobs={[done('a', 'a.heic'), done('b', 'b.heic')]} to="jpg" />,
    ],
    [
      'SettingsPanel',
      <SettingsPanel key="s" schema={VIDEO_COMPRESSION_SCHEMA} values={{}} onChange={() => {}} />,
    ],
  ]

  for (const [name, element] of cases) {
    it(`${name}: every focusable control is named`, () => {
      const { container } = render(element)

      const controls = focusables(container)
      expect(controls.length).toBeGreaterThan(0)

      for (const control of controls) {
        expect(accessibleName(control), `${name}: an unnamed ${control.tagName}`).toMatch(/\S/)
      }
    })
  }
})

describe('the queue is reachable in the order it is read', () => {
  it('reaches each card in list order, never jumping between them', () => {
    render(
      <ul>
        {['first.heic', 'second.heic'].map((name, index) => (
          <li key={name}>
            <JobCard
              job={{ ...createJob(`j${index}`, new File(['x'], name)), state: 'processing' }}
              onCancel={() => {}}
              now={0}
            />
          </li>
        ))}
      </ul>,
    )

    const names = screen
      .getAllByRole('button')
      .map((button) => button.getAttribute('aria-label') ?? '')

    expect(names[0]).toMatch(/first\.heic/)
    expect(names[names.length - 1]).toMatch(/second\.heic/)
  })
})

describe('the converter components, as source', () => {
  const sources = readdirSync(converterDir)
    .filter((file) => file.endsWith('.tsx') || file.endsWith('.ts'))
    .map(
      (file) =>
        [
          file,
          readFileSync(join(converterDir, file), 'utf8')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/(^|[^:])\/\/.*$/gm, '$1'),
        ] as const,
    )

  it('scans every file in components/converter', () => {
    expect(sources.length).toBeGreaterThan(5)
  })

  /*
   * A positive tabIndex takes an element out of document order and puts it in
   * front of everything that has none — across the whole page, not just this
   * component. One of them anywhere makes the rest of the tab order wrong.
   */
  it('never puts anything in front of the natural tab order', () => {
    for (const [file, code] of sources) {
      expect(code, `${file} sets a positive tabIndex`).not.toMatch(/tabIndex=\{[1-9]/)
    }
  })

  /*
   * `outline-none` with nothing to replace it removes the only indication a
   * keyboard user has of where they are. It is allowed only where the same
   * file draws a focus indicator of its own.
   */
  it('never removes the focus indicator without drawing another', () => {
    for (const [file, code] of sources) {
      if (!/\boutline-none\b/.test(code)) continue

      expect(code, `${file} removes the focus outline without replacing it`).toMatch(
        /focus-visible:(outline|ring|border)|focus-within:outline/,
      )
    }
  })

  /*
   * An icon-only control renders no text, so `aria-label` is the only name it
   * can have. The rendered cases above cover the ones they draw; this covers
   * the variants they do not.
   */
  it('names every icon-only button', () => {
    for (const [file, code] of sources) {
      for (const match of code.matchAll(/size="icon"/g)) {
        const around = code.slice(Math.max(0, match.index - 400), match.index + 400)
        expect(around, `${file} has an icon button with no aria-label`).toMatch(/aria-label=/)
      }
    }
  })
})
