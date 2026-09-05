// @vitest-environment node

/**
 * The schema each tool page offers, and the promise that every control on it
 * reaches an engine (issue #265).
 *
 * The panel and the schema language were both finished and both dead: nothing
 * rendered a panel and nothing mapped one onto `EngineInput`. This is the join,
 * so the assertions here are mostly about *absence* — a page that offers a
 * quality slider for a lossless target, or a bitrate for PCM, is a control that
 * moves and changes nothing, which is worse than no control at all.
 */

import { describe, expect, it } from 'vitest'

import { PAIRS, pairBySlug } from '@/lib/registry/pairs'
import { settingsFor } from '@/lib/settings/for-pair'
import { defaultValues, setValue } from '@/lib/settings/values'

const forSlug = (slug: string) => settingsFor(pairBySlug(slug)!)

const ids = (slug: string) => forSlug(slug)?.schema.fields.map((field) => field.id)

/** What a page sends when nobody touches the panel. */
const defaults = (slug: string) => {
  const settings = forSlug(slug)
  if (settings === null) throw new Error(`${slug} offers no settings`)

  return settings.toJobSettings(defaultValues(settings.schema))
}

const SLOTS = ['image', 'pdf', 'video', 'audio']

describe('every page in the catalogue', () => {
  it('either offers no panel or fills only the slots an engine reads', () => {
    for (const pair of PAIRS) {
      const settings = settingsFor(pair)
      if (settings === null) continue

      const job = settings.toJobSettings(defaultValues(settings.schema))

      expect(Object.keys(job), pair.slug).not.toHaveLength(0)
      for (const key of Object.keys(job)) expect(SLOTS, pair.slug).toContain(key)
    }
  })

  it('gives every field a label, a help line and a legal default', () => {
    for (const pair of PAIRS) {
      const schema = settingsFor(pair)?.schema
      if (schema === undefined) continue

      expect(schema.title.length, pair.slug).toBeGreaterThan(0)

      for (const field of schema.fields) {
        expect(field.label.length, `${pair.slug}/${field.id}`).toBeGreaterThan(0)

        // A field says what it does to the file, either on itself or — for a
        // choice whose options differ from one another — on every option.
        const explained =
          field.help !== undefined ||
          (field.kind === 'choice' && field.options.every((option) => option.help !== undefined))
        expect(explained, `${pair.slug}/${field.id}`).toBe(true)

        if (field.kind === 'number') {
          expect(field.default, `${pair.slug}/${field.id}`).toBeGreaterThanOrEqual(field.min)
          expect(field.default, `${pair.slug}/${field.id}`).toBeLessThanOrEqual(field.max)
        }

        if (field.kind === 'choice') {
          expect(
            field.options.map((option) => option.value),
            `${pair.slug}/${field.id}`,
          ).toContain(field.default)
        }
      }
    }
  })
})

describe('images', () => {
  it('offers quality and metadata for a lossy target', () => {
    expect(ids('heic-to-jpg')).toEqual(['quality', 'keepMetadata'])
    expect(defaults('heic-to-jpg')).toEqual({ image: { quality: 80, keepMetadata: false } })
  })

  it('offers no quality for a lossless one, because there is no dial to turn', () => {
    expect(ids('png-to-tiff')).toEqual(['keepMetadata'])
    expect(defaults('png-to-tiff')).toEqual({ image: { keepMetadata: false } })
  })

  it('asks a drawing how wide it should be rasterised', () => {
    expect(ids('svg-to-png')).toEqual(['width', 'keepMetadata'])
    expect(defaults('svg-to-png')).toMatchObject({ image: { width: 1024 } })
  })

  it('carries what the user actually chose', () => {
    const settings = forSlug('heic-to-jpg')!
    const values = setValue(settings.schema, defaultValues(settings.schema), 'quality', 40)

    expect(settings.toJobSettings(values)).toEqual({
      image: { quality: 40, keepMetadata: false },
    })
  })

  it('offers nothing for an assembly into a document', () => {
    expect(forSlug('jpg-to-pdf')).toBeNull()
    expect(forSlug('png-to-pdf')).toBeNull()
  })
})

describe('pages rendered out of a PDF', () => {
  it('asks for a resolution, and a quality only where one is encoded', () => {
    expect(ids('pdf-to-jpg')).toEqual(['dpi', 'quality'])
    expect(ids('pdf-to-png')).toEqual(['dpi'])
  })

  it('hands pdf.js a fraction, which is the scale it reads', () => {
    expect(defaults('pdf-to-jpg')).toEqual({ pdf: { render: { dpi: 150, quality: 0.8 } } })
    expect(defaults('pdf-to-png')).toEqual({ pdf: { render: { dpi: 150 } } })
  })

  it('offers nothing when the pages become words', () => {
    expect(forSlug('pdf-to-txt')).toBeNull()
  })
})

describe('sound', () => {
  it('offers a bitrate for a lossy target, in bits per second', () => {
    expect(ids('mp4-to-mp3')).toEqual(['bitrate'])
    expect(defaults('mp4-to-mp3')).toEqual({ audio: { bitrate: 192_000 } })
    expect(defaults('mp3-to-m4a')).toEqual({ audio: { bitrate: 192_000 } })
  })

  it('offers no bitrate where the format keeps every sample', () => {
    // WAV is PCM and FLAC is lossless: a rate cannot change either file.
    expect(forSlug('mp3-to-wav')).toBeNull()
    expect(forSlug('mp3-to-flac')).toBeNull()
  })
})

describe('video', () => {
  it('reuses the compression schema the engines already implement', () => {
    expect(forSlug('mp4-to-webm')?.schema.title).toBe('Compression')
    expect(defaults('mp4-to-webm')).toEqual({
      video: { hardware: true, compression: { method: 'quality', crf: 23 } },
    })
  })

  it('asks a GIF only what a GIF can answer', () => {
    // The palette filter reads a width and a frame rate; a CRF or a bitrate
    // would be a control that moves and changes nothing.
    expect(ids('mp4-to-gif')).toEqual(['width', 'frameRate'])
    expect(defaults('mp4-to-gif')).toEqual({ video: { width: 480, frameRate: 12 } })
  })
})
