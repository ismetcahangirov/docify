// @vitest-environment node

/**
 * The values behind a schema-driven panel (issue #60).
 *
 * Every assertion here is about a wrong answer that would otherwise reach an
 * engine: a value outside its own range, a number that arrived as text, or — the
 * one that matters most — a field the user filled in and then hid.
 */

import { describe, expect, it } from 'vitest'

import type { SettingsSchema } from '@/lib/settings/schema'
import {
  defaultValues,
  isVisible,
  normalise,
  setValue,
  visibleFields,
  visibleValues,
} from '@/lib/settings/values'

const schema: SettingsSchema = {
  title: 'Compression',
  fields: [
    {
      id: 'method',
      kind: 'choice',
      label: 'Method',
      default: 'quality',
      options: [
        { value: 'quality', label: 'Quality' },
        { value: 'size', label: 'Target size' },
      ],
    },
    {
      id: 'crf',
      kind: 'number',
      label: 'Quality',
      min: 16,
      max: 34,
      step: 1,
      default: 23,
      visibleWhen: { field: 'method', equals: ['quality'] },
    },
    {
      id: 'targetMb',
      kind: 'number',
      label: 'Target size',
      min: 1,
      max: 4096,
      step: 1,
      default: 8,
      visibleWhen: { field: 'method', equals: ['size'] },
    },
    { id: 'hardware', kind: 'toggle', label: 'Hardware', default: true },
  ],
}

const ids = (fields: readonly { id: string }[]) => fields.map((field) => field.id)

describe('defaultValues', () => {
  it('is every field at what it declared', () => {
    expect(defaultValues(schema)).toEqual({
      method: 'quality',
      crf: 23,
      targetMb: 8,
      hardware: true,
    })
  })
})

describe('visibility', () => {
  it('shows a field with no rule, always', () => {
    expect(isVisible(schema.fields[3], { method: 'size' }, schema)).toBe(true)
  })

  it('shows a dependent field only while its rule holds', () => {
    expect(ids(visibleFields(schema, defaultValues(schema)))).toEqual(['method', 'crf', 'hardware'])
    expect(ids(visibleFields(schema, { ...defaultValues(schema), method: 'size' }))).toEqual([
      'method',
      'targetMb',
      'hardware',
    ])
  })

  it('hides a field whose rule names something that is not in the schema', () => {
    // A typo should hide a control someone can report as missing, not show one
    // whose value is applied on top of a setting it contradicts.
    const broken: SettingsSchema = {
      title: 'Broken',
      fields: [
        {
          id: 'a',
          kind: 'toggle',
          label: 'A',
          default: true,
          visibleWhen: { field: 'nope', equals: [true] },
        },
      ],
    }

    expect(visibleFields(broken, { a: true })).toEqual([])
  })
})

describe('visibleValues', () => {
  it('sends only what the user can see', () => {
    // The case this function exists for: a target size typed, then abandoned by
    // switching back to constant quality. Sending both lets whichever consumer
    // reads first decide.
    const typed = setValue(schema, defaultValues(schema), 'targetMb', 40)
    const switched = setValue(schema, typed, 'method', 'quality')

    expect(visibleValues(schema, switched)).toEqual({ method: 'quality', crf: 23, hardware: true })
  })

  it('fills in a default for a field nobody has touched', () => {
    expect(visibleValues(schema, { method: 'size' })).toEqual({
      method: 'size',
      targetMb: 8,
      hardware: true,
    })
  })
})

describe('setValue', () => {
  it('changes the one field it names', () => {
    expect(setValue(schema, defaultValues(schema), 'crf', 18).crf).toBe(18)
  })

  it('ignores a field the schema does not declare, and does not re-render for it', () => {
    const values = defaultValues(schema)

    expect(setValue(schema, values, 'nope', 1)).toBe(values)
  })

  it('does not re-render for a value that says the same thing', () => {
    const values = defaultValues(schema)

    expect(setValue(schema, values, 'crf', 23)).toBe(values)
  })

  it('clamps rather than refusing, because a control can only be wrong by a bug', () => {
    expect(setValue(schema, defaultValues(schema), 'crf', 400).crf).toBe(34)
    expect(setValue(schema, defaultValues(schema), 'crf', -5).crf).toBe(16)
  })

  it('takes the number out of the string a number input hands back', () => {
    expect(setValue(schema, defaultValues(schema), 'crf', '19').crf).toBe(19)
  })

  it('falls back to the default for an empty box rather than to zero', () => {
    expect(setValue(schema, defaultValues(schema), 'crf', '').crf).toBe(23)
  })

  it('snaps a typed value onto the step', () => {
    const stepped: SettingsSchema = {
      title: 'Rate',
      fields: [
        {
          id: 'kbps',
          kind: 'number',
          label: 'Rate',
          min: 100,
          max: 10_000,
          step: 100,
          default: 3000,
        },
      ],
    }

    expect(setValue(stepped, { kbps: 3000 }, 'kbps', 3049).kbps).toBe(3000)
    expect(setValue(stepped, { kbps: 3000 }, 'kbps', 3051).kbps).toBe(3100)
  })

  it('keeps the current choice when handed one that does not exist', () => {
    expect(setValue(schema, defaultValues(schema), 'method', 'nonsense').method).toBe('quality')
  })

  it('reads a toggle out of whatever a checkbox handed over', () => {
    expect(setValue(schema, defaultValues(schema), 'hardware', false).hardware).toBe(false)
    expect(
      setValue(schema, { ...defaultValues(schema), hardware: false }, 'hardware', 'true').hardware,
    ).toBe(true)
  })
})

describe('normalise', () => {
  it('drops a key the schema no longer declares', () => {
    // State outlives a schema: a saved preference, a URL, a tool whose options
    // changed between releases. A leftover key is a value nothing validates.
    expect(normalise(schema, { ...defaultValues(schema), gone: 1 })).not.toHaveProperty('gone')
  })

  it('fills in every field that is missing', () => {
    expect(normalise(schema, {})).toEqual(defaultValues(schema))
  })

  it('pulls an out-of-range value that arrived from somewhere else back in', () => {
    expect(normalise(schema, { crf: 900 }).crf).toBe(34)
  })
})
