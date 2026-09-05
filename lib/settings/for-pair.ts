/**
 * Which controls a tool page offers, and what they mean to an engine.
 *
 * The join between `./schema` — which can describe a panel — and
 * `lib/engines/*-options` — which is what a job actually carries. Both halves
 * existed and neither was connected to the other (issue #265): the panel was
 * rendered nowhere, so every conversion ran on the engine's own defaults and a
 * quality the user chose could not reach one.
 *
 * ## A control that changes nothing is worse than no control
 *
 * That is the rule this file is built on, and it is why the decision is not
 * simply "the target's family". A GIF written by ffmpeg reads a width and a
 * frame rate and ignores a CRF; a WAV is PCM, so a bitrate cannot change its
 * size by a byte; a PNG has no lossy dial at all. Offering any of those anyway
 * gives the user a slider that moves, a file that does not change, and no way
 * to tell which of the two is broken.
 *
 * So each branch below names the engine slot it fills, and every field in the
 * schema beside it is one an engine on that path demonstrably reads. When
 * nothing on a path reads anything the answer is `null` and the page shows no
 * panel, which is the honest version of "this conversion has no settings".
 *
 * ## Why the values are read through `visibleValues`
 *
 * A hidden field is not applied. `./values` makes the argument at length; the
 * consequence here is that `toJobSettings` never reads the record it is handed
 * directly, so a target size typed and then hidden by switching methods does
 * not travel with the job.
 */

import type { EngineInput } from '@/lib/engines/types'
import { formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import type { FormatId } from '@/lib/router/types'

import type { NumberField, SettingsSchema, SettingsValues } from './schema'
import { visibleValues } from './values'
import { toVideoOptions, VIDEO_COMPRESSION_SCHEMA } from './video'

/**
 * The settings a job carries into whichever engine takes it.
 *
 * The same four slots `EngineInput` declares and nothing else: a panel may
 * describe a job, never the machinery that runs it.
 */
export type JobSettings = Pick<EngineInput, 'image' | 'pdf' | 'video' | 'audio'>

/** One page's panel, and the translation of what it holds. */
export interface PairSettings {
  schema: SettingsSchema
  /** What the panel currently holds, as the engines' own options. */
  toJobSettings(values: SettingsValues): JobSettings
}

/** Image targets with an encoder quality to turn. The rest write every pixel. */
const LOSSY_IMAGES: ReadonlySet<FormatId> = new Set(['jpg', 'webp', 'avif', 'gif', 'heic'])

/**
 * Audio targets a bitrate means something to.
 *
 * WAV is 16-bit PCM and FLAC is lossless, so the rate of either is a property
 * of the recording rather than a setting — the same fact the `lossless` flag on
 * `FFMPEG_TARGETS` states on the engine's side.
 */
const LOSSY_AUDIO: ReadonlySet<FormatId> = new Set(['mp3', 'm4a', 'aac', 'ogg'])

/** The quality slider, which reads the same on every page that has one. */
const QUALITY: NumberField = {
  id: 'quality',
  kind: 'number',
  control: 'slider',
  label: 'Quality',
  help: 'Lower is smaller. 80 keeps photographs looking untouched.',
  min: 1,
  max: 100,
  step: 1,
  default: 80,
}

/**
 * The panel `pair` should show, or `null` when nothing it could offer would
 * reach an engine.
 */
export function settingsFor(pair: ConversionPair): PairSettings | null {
  const source = formatMeta(pair.from).kind
  const target = formatMeta(pair.to).kind

  // By name rather than by kind: a document is not automatically a PDF, and
  // these are pdf.js' own settings rather than every document reader's.
  if (pair.from === 'pdf') return pdfRenderSettings(pair)
  if (source === 'video' && target === 'image') return gifSettings()
  if (target === 'video') return videoSettings()
  if (target === 'audio') return audioSettings(pair)
  if (source === 'image' && target === 'image') return imageSettings(pair)

  return null
}

/**
 * Quality, size and metadata for a picture that stays a picture.
 *
 * `width` only for a drawing, because that is the one source with no pixel size
 * of its own: rasterising an SVG has to be told how big, and every other source
 * already knows. A general resize is a different feature — `lib/engines`
 * implements one — and belongs on a page about resizing rather than on all
 * fifty conversion pages at once.
 */
function imageSettings(pair: ConversionPair): PairSettings {
  const lossy = LOSSY_IMAGES.has(pair.to)
  const vector = pair.from === 'svg'

  const schema: SettingsSchema = {
    title: 'Image',
    fields: [
      ...(vector
        ? [
            {
              id: 'width',
              kind: 'number',
              control: 'input',
              label: 'Width',
              unit: 'px',
              help: "The height follows the drawing's own proportions.",
              min: 16,
              max: 16_384,
              step: 1,
              default: 1024,
            } satisfies NumberField,
          ]
        : []),
      ...(lossy ? [QUALITY] : []),
      {
        id: 'keepMetadata',
        kind: 'toggle',
        label: 'Keep the original metadata',
        help: 'Carries EXIF, ICC and XMP across. EXIF can hold the coordinates the photo was taken at.',
        default: false,
      },
    ],
  }

  return {
    schema,
    toJobSettings(values) {
      const applied = visibleValues(schema, values)

      return {
        image: {
          ...(vector ? { width: number(applied.width) } : {}),
          ...(lossy ? { quality: number(applied.quality) } : {}),
          keepMetadata: applied.keepMetadata === true,
        },
      }
    },
  }
}

/**
 * Resolution, and a quality only where one is encoded.
 *
 * The range stops well inside what `renderDpi` accepts. Its own limits are 12
 * and 1200, and they exist so that a value arriving another way is refused
 * rather than trusted; a slider reaching 1200 dpi is a slider that lets someone
 * ask for an A4 page as a 140-megapixel canvas.
 */
function pdfRenderSettings(pair: ConversionPair): PairSettings | null {
  if (pair.to !== 'jpg' && pair.to !== 'png') return null
  const lossy = pair.to === 'jpg'

  const schema: SettingsSchema = {
    title: 'Pages',
    fields: [
      {
        id: 'dpi',
        kind: 'number',
        control: 'input',
        label: 'Resolution',
        unit: 'dpi',
        help: '150 is enough to read on a screen; 300 is what a printer asks for.',
        min: 72,
        max: 300,
        step: 1,
        default: 150,
      },
      ...(lossy ? [QUALITY] : []),
    ],
  }

  return {
    schema,
    toJobSettings(values) {
      const applied = visibleValues(schema, values)

      return {
        pdf: {
          render: {
            dpi: number(applied.dpi),
            // pdf.js takes a fraction rather than a percentage, and the panel
            // speaks the percentage every other quality control here uses.
            ...(lossy ? { quality: number(applied.quality) / 100 } : {}),
          },
        },
      }
    },
  }
}

/** The four sizing methods the video engines implement, declared once in `./video`. */
function videoSettings(): PairSettings {
  return {
    schema: VIDEO_COMPRESSION_SCHEMA,
    toJobSettings: (values) => ({ video: toVideoOptions(values) }),
  }
}

/**
 * The two settings a GIF made from a video actually has.
 *
 * `paletteFilter` in `lib/engines/ffmpeg-args` reads a width and a frame rate
 * and nothing else — a GIF has no CRF, no bitrate and no sound — so the
 * compression schema here would be four controls of which one worked.
 */
function gifSettings(): PairSettings {
  const schema: SettingsSchema = {
    title: 'Picture',
    fields: [
      {
        id: 'width',
        kind: 'number',
        control: 'input',
        label: 'Width',
        unit: 'px',
        help: 'The height follows. A GIF is usually a heavy downscale of its source.',
        min: 16,
        max: 1920,
        step: 2,
        default: 480,
      },
      {
        id: 'frameRate',
        kind: 'number',
        control: 'slider',
        label: 'Frames per second',
        help: 'Fewer frames make a much smaller file. 12 still reads as motion.',
        min: 5,
        max: 30,
        step: 1,
        default: 12,
      },
    ],
  }

  return {
    schema,
    toJobSettings(values) {
      const applied = visibleValues(schema, values)

      return { video: { width: number(applied.width), frameRate: number(applied.frameRate) } }
    },
  }
}

/**
 * The one dial a lossy audio encoder has.
 *
 * A short list rather than a slider: nobody wants 187 kbps, and the five rates
 * below are the ones every download service and podcast host publishes, so the
 * number a user already recognises is the number they are offered.
 */
function audioSettings(pair: ConversionPair): PairSettings | null {
  if (!LOSSY_AUDIO.has(pair.to)) return null

  const schema: SettingsSchema = {
    title: 'Audio',
    fields: [
      {
        id: 'bitrate',
        kind: 'choice',
        label: 'Bitrate',
        help: 'Higher keeps more of the recording and makes a larger file. 192 is transparent for most music.',
        default: '192',
        options: [
          { value: '96', label: '96 kbps', help: 'Speech, and the smallest file worth keeping.' },
          { value: '128', label: '128 kbps' },
          { value: '192', label: '192 kbps' },
          { value: '256', label: '256 kbps' },
          { value: '320', label: '320 kbps', help: 'As good as these formats get.' },
        ],
      },
    ],
  }

  return {
    schema,
    toJobSettings(values) {
      const applied = visibleValues(schema, values)

      // The engines count in bits per second; the panel counts in the kbps
      // every encoder's own documentation is written in.
      return { audio: { bitrate: number(applied.bitrate) * 1000 } }
    },
  }
}

/** A value `normalise` has already coerced, narrowed for the compiler. */
function number(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}
