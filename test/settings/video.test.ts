// @vitest-environment node

/**
 * The video compression schema (issue #60), and the round trip it exists to
 * prove: a declaration renders a panel, the panel produces values, and the
 * values become the engines' own options with nothing invented in between.
 */

import { describe, expect, it } from 'vitest'

import { MAX_CRF, MIN_CRF } from '@/lib/engines/video-compression'
import { defaultValues, setValue, visibleFields } from '@/lib/settings/values'
import {
  SLIDER_MAX_CRF,
  SLIDER_MIN_CRF,
  toVideoOptions,
  VIDEO_COMPRESSION_SCHEMA as SCHEMA,
} from '@/lib/settings/video'

const ids = (values = defaultValues(SCHEMA)) => visibleFields(SCHEMA, values).map((f) => f.id)

const pick = (method: string) => setValue(SCHEMA, defaultValues(SCHEMA), 'method', method)

describe('the schema', () => {
  it('offers the four sizing methods the engines implement, and no fifth', () => {
    const method = SCHEMA.fields.find((field) => field.id === 'method')
    if (method?.kind !== 'choice') throw new Error('the method field is not a choice')

    expect(method.options.map((option) => option.value).sort()).toEqual(
      ['max-bitrate', 'quality', 'resize', 'target-size'].sort(),
    )
  })

  it('shows one setting at a time, so nobody has to guess which is in force', () => {
    expect(ids(pick('quality'))).toEqual(['method', 'crf', 'hardware'])
    expect(ids(pick('target-size'))).toEqual(['method', 'targetMb', 'hardware'])
    expect(ids(pick('max-bitrate'))).toEqual(['method', 'maxKbps', 'hardware'])
    expect(ids(pick('resize'))).toEqual(['method', 'width', 'hardware'])
  })

  it('keeps the quality slider inside the useful part of the scale', () => {
    // CRF 0 is lossless and several times the source; past about 35 nobody would
    // keep the result. Offering either is offering a way to waste time.
    expect(SLIDER_MIN_CRF).toBeGreaterThan(MIN_CRF)
    expect(SLIDER_MAX_CRF).toBeLessThan(MAX_CRF)
  })

  it('gives every field a label and every default a legal value', () => {
    for (const field of SCHEMA.fields) {
      expect(field.label.length).toBeGreaterThan(0)

      if (field.kind === 'number') {
        expect(field.default).toBeGreaterThanOrEqual(field.min)
        expect(field.default).toBeLessThanOrEqual(field.max)
      }

      if (field.kind === 'choice') {
        expect(field.options.map((option) => option.value)).toContain(field.default)
      }
    }
  })

  it('names every field a rule depends on', () => {
    const declared = new Set(SCHEMA.fields.map((field) => field.id))

    for (const field of SCHEMA.fields) {
      if (field.visibleWhen !== undefined) expect(declared).toContain(field.visibleWhen.field)
    }
  })
})

describe('toVideoOptions', () => {
  it('turns each method into the compression the engines understand', () => {
    expect(toVideoOptions(pick('quality')).compression).toEqual({ method: 'quality', crf: 23 })
    expect(toVideoOptions(pick('target-size')).compression).toEqual({
      method: 'target-size',
      targetBytes: 8 * 1024 * 1024,
    })
    expect(toVideoOptions(pick('max-bitrate')).compression).toEqual({
      method: 'max-bitrate',
      bitrate: 3_000_000,
    })
    expect(toVideoOptions(pick('resize')).compression).toEqual({ method: 'resize', width: 1280 })
  })

  it('converts the units the panel shows into the units the engines take', () => {
    // The panel says megabytes and kilobits because that is what people type;
    // the engines take bytes and bits.
    const sized = setValue(SCHEMA, pick('target-size'), 'targetMb', 25)
    expect(toVideoOptions(sized).compression).toEqual({
      method: 'target-size',
      targetBytes: 25 * 1024 * 1024,
    })

    const capped = setValue(SCHEMA, pick('max-bitrate'), 'maxKbps', 4_500)
    expect(toVideoOptions(capped).compression).toEqual({
      method: 'max-bitrate',
      bitrate: 4_500_000,
    })
  })

  it('never carries a setting the user has hidden', () => {
    // A target size typed and then abandoned by switching to constant quality.
    const typed = setValue(SCHEMA, pick('target-size'), 'targetMb', 40)
    const switched = setValue(SCHEMA, typed, 'method', 'quality')

    expect(toVideoOptions(switched).compression).toEqual({ method: 'quality', crf: 23 })
  })

  it('carries the hardware preference through every method', () => {
    for (const method of ['quality', 'target-size', 'max-bitrate', 'resize']) {
      const off = setValue(SCHEMA, pick(method), 'hardware', false)

      expect(toVideoOptions(off).hardware).toBe(false)
      expect(toVideoOptions(pick(method)).hardware).toBe(true)
    }
  })

  it('answers something legal for values that never came from the panel at all', () => {
    // A saved preference, a URL, a stale local copy: normalisation happens on
    // the way out, so nothing downstream has to check.
    expect(toVideoOptions({ method: 'quality', crf: 900 }).compression).toEqual({
      method: 'quality',
      crf: SLIDER_MAX_CRF,
    })
  })
})
