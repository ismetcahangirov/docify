import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { SettingsPanel } from '@/components/converter/settings-panel'
import type { SettingsSchema, SettingsValues } from '@/lib/settings/schema'
import { defaultValues } from '@/lib/settings/values'
import { VIDEO_COMPRESSION_SCHEMA } from '@/lib/settings/video'

import { COLOURS } from '../../support/tokens'

/*
 * The schema-driven panel (issue #60).
 *
 * Nothing here builds a form. Every assertion is that a *declaration* produced
 * the right control, with the right name, wired to the right description — which
 * is the entire argument for a schema over a hundred hand-built forms.
 *
 * The last block drives the panel from the real video compression schema rather
 * than a fixture, because a schema the panel cannot render is a schema that
 * fails on a tool page and nowhere else.
 */

const schema: SettingsSchema = {
  title: 'Compression',
  fields: [
    {
      id: 'method',
      kind: 'choice',
      label: 'How to size the result',
      default: 'quality',
      options: [
        { value: 'quality', label: 'Constant quality', help: 'A fixed quality.' },
        { value: 'size', label: 'Target file size' },
      ],
    },
    {
      id: 'crf',
      kind: 'number',
      control: 'slider',
      label: 'Quality',
      help: 'Lower is better and larger.',
      min: 16,
      max: 34,
      step: 1,
      default: 23,
      visibleWhen: { field: 'method', equals: ['quality'] },
    },
    {
      id: 'targetMb',
      kind: 'number',
      control: 'input',
      label: 'Target size',
      unit: 'MB',
      min: 1,
      max: 4096,
      step: 1,
      default: 8,
      visibleWhen: { field: 'method', equals: ['size'] },
    },
    {
      id: 'hardware',
      kind: 'toggle',
      label: 'Use the hardware encoder',
      help: 'Much faster.',
      default: true,
    },
  ],
}

const menu: SettingsSchema = {
  title: 'Output',
  fields: [
    {
      id: 'format',
      kind: 'choice',
      label: 'Format',
      default: 'mp4',
      options: ['mp4', 'webm', 'mkv', 'mov', 'avi'].map((value) => ({ value, label: value })),
    },
  ],
}

function renderPanel(used: SettingsSchema = schema, values: SettingsValues = defaultValues(used)) {
  const onChange = vi.fn()
  const view = render(<SettingsPanel schema={used} values={values} onChange={onChange} />)

  return { onChange, view }
}

const field = (id: string) => document.querySelector(`[data-field="${id}"]`)

describe('SettingsPanel — it renders the declaration', () => {
  it('names the group, so a screen reader says which controls it has entered', () => {
    renderPanel()

    expect(screen.getByRole('group', { name: /compression/i })).toBeInTheDocument()
  })

  it('draws a short choice as radio buttons, where every option is visible at once', () => {
    renderPanel()

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.getByRole('radio', { name: /constant quality/i })).toBeChecked()
  })

  it('draws a long choice as a menu instead', () => {
    renderPanel(menu)

    expect(screen.getByRole('combobox', { name: 'Format' })).toBeInTheDocument()
    expect(screen.queryByRole('radio')).not.toBeInTheDocument()
  })

  it('draws a slider where the field asked for one, with its own bounds', () => {
    renderPanel()

    const slider = screen.getByRole('slider', { name: 'Quality' })
    expect(slider).toHaveAttribute('min', '16')
    expect(slider).toHaveAttribute('max', '34')
    expect(slider).toHaveValue('23')
  })

  it('draws a typed box where the field asked for one', () => {
    renderPanel(schema, { ...defaultValues(schema), method: 'size' })

    expect(screen.getByRole('spinbutton', { name: 'Target size' })).toHaveValue(8)
  })

  it('shows the current value beside a control whose number is otherwise invisible', () => {
    // A slider says nothing about where it is; the readout is what makes it a
    // setting rather than a guess.
    renderPanel()

    expect(field('crf')?.querySelector('[data-slot="settings-field-value"]')?.textContent).toBe(
      '23',
    )
  })

  it('shows the unit where the field named one', () => {
    renderPanel(schema, { ...defaultValues(schema), method: 'size' })

    expect(
      field('targetMb')?.querySelector('[data-slot="settings-field-value"]')?.textContent,
    ).toBe('8 MB')
  })

  it('draws a toggle as a checkbox', () => {
    renderPanel()

    expect(screen.getByRole('checkbox', { name: /hardware encoder/i })).toBeChecked()
  })
})

describe('SettingsPanel — it wires every control the same way', () => {
  it('binds each help line to its control, rather than printing it alongside', () => {
    renderPanel()

    expect(screen.getByRole('slider', { name: 'Quality' })).toHaveAccessibleDescription(
      'Lower is better and larger.',
    )
    expect(screen.getByRole('checkbox', { name: /hardware/i })).toHaveAccessibleDescription(
      'Much faster.',
    )
    expect(screen.getByRole('radio', { name: /constant quality/i })).toHaveAccessibleDescription(
      'A fixed quality.',
    )
  })

  it('leaves the description off a control that has nothing to add', () => {
    renderPanel()

    expect(screen.getByRole('radio', { name: /target file size/i })).not.toHaveAttribute(
      'aria-describedby',
    )
  })

  it('gives a radio group a legend, so the choice is announced as one question', () => {
    // Without it a screen reader reads two unrelated options and never says what
    // the choice is about.
    renderPanel()

    expect(screen.getByRole('group', { name: 'How to size the result' })).toBeInTheDocument()
  })

  it('gives every option row a hit area the responsive contract allows', () => {
    // A checkbox is 16px and the floor is 44. The row is the control.
    renderPanel()

    for (const radio of screen.getAllByRole('radio')) {
      expect(radio.closest('label')?.className).toContain('min-h-11')
    }
    expect(screen.getByRole('checkbox').closest('label')?.className).toContain('min-h-11')
  })

  it('disables every control at once when the panel is disabled', () => {
    render(
      <SettingsPanel schema={schema} values={defaultValues(schema)} onChange={vi.fn()} disabled />,
    )

    expect(screen.getByRole('slider', { name: 'Quality' })).toBeDisabled()
    expect(screen.getByRole('checkbox')).toBeDisabled()
  })
})

describe('SettingsPanel — what a change produces', () => {
  it('reports the whole set of values, not just the field that moved', () => {
    const { onChange } = renderPanel()

    fireEvent.change(screen.getByRole('slider', { name: 'Quality' }), { target: { value: '18' } })

    expect(onChange).toHaveBeenCalledWith({ ...defaultValues(schema), crf: 18 })
  })

  it('coerces on the way out, so nothing downstream has to check', () => {
    const { onChange } = renderPanel()

    fireEvent.change(screen.getByRole('slider', { name: 'Quality' }), { target: { value: '900' } })

    expect(onChange).toHaveBeenCalledWith({ ...defaultValues(schema), crf: 34 })
  })

  it('reads a toggle out of the checkbox rather than out of its value attribute', () => {
    const { onChange } = renderPanel()

    fireEvent.click(screen.getByRole('checkbox'))

    expect(onChange).toHaveBeenCalledWith({ ...defaultValues(schema), hardware: false })
  })

  it('shows a different setting when the method changes', () => {
    const { onChange } = renderPanel()

    fireEvent.click(screen.getByRole('radio', { name: /target file size/i }))

    const next = onChange.mock.calls[0][0] as SettingsValues
    expect(next.method).toBe('size')

    // Re-rendered with what the panel reported, the dependent field swaps.
    render(<SettingsPanel schema={schema} values={next} onChange={vi.fn()} />)
    expect(screen.getByRole('spinbutton', { name: 'Target size' })).toBeInTheDocument()
  })

  it('holds no copy of its own', () => {
    // A panel with private state answers one thing while the job carries
    // another the moment anything resets it, and the user is looking at a lie.
    renderPanel()

    fireEvent.change(screen.getByRole('slider', { name: 'Quality' }), { target: { value: '18' } })

    expect(screen.getByRole('slider', { name: 'Quality' })).toHaveValue('23')
  })
})

describe('SettingsPanel — the real video schema', () => {
  it('renders every field the declaration asks for', () => {
    renderPanel(VIDEO_COMPRESSION_SCHEMA)

    expect(screen.getAllByRole('radio')).toHaveLength(4)
    expect(screen.getByRole('slider', { name: 'Quality' })).toBeInTheDocument()
    expect(screen.getByRole('checkbox')).toBeInTheDocument()
  })

  it('swaps the one setting as the method changes, for all four of them', () => {
    const values = defaultValues(VIDEO_COMPRESSION_SCHEMA)
    const shown: Record<string, string> = {
      quality: 'crf',
      'target-size': 'targetMb',
      'max-bitrate': 'maxKbps',
      resize: 'width',
    }

    for (const [method, id] of Object.entries(shown)) {
      const { unmount } = render(
        <SettingsPanel
          schema={VIDEO_COMPRESSION_SCHEMA}
          values={{ ...values, method }}
          onChange={vi.fn()}
        />,
      )

      expect(field(id)).not.toBeNull()
      for (const other of Object.values(shown)) {
        if (other !== id) expect(field(other)).toBeNull()
      }

      unmount()
    }
  })
})

describe('SettingsPanel — the design contract', () => {
  it('paints itself only from the @theme palette', () => {
    renderPanel()

    const group = screen.getByRole('group', { name: /compression/i })
    const classes = [group, ...group.querySelectorAll('*')]
      .flatMap((node) => [
        ...node.className.toString().matchAll(/(?:bg|text|border)-([a-z0-9-]+)/g),
      ])
      .map((match) => match[1])

    for (const colour of classes) {
      if (['current', 'body', 'h3', 'eyebrow', 'tech'].includes(colour)) continue

      expect(COLOURS.has(colour)).toBe(true)
    }
  })

  it('draws no shadow, ring or blur anywhere in the form', () => {
    renderPanel()

    const group = screen.getByRole('group', { name: /compression/i })
    for (const node of [group, ...group.querySelectorAll('*')]) {
      expect(node.className.toString()).not.toMatch(/shadow|backdrop-|ring-/)
    }
  })
})
