/**
 * The video compression panel, declared rather than drawn — and the worked
 * example that the schema in `./schema` is actually enough.
 *
 * The four sizing methods of `lib/engines/video-compression.ts` are the hardest
 * case a settings panel here has to answer: they are alternatives, each carries
 * its own single setting, and showing all four settings at once would make the
 * user guess which of them is in force. That is exactly what
 * {@link Field.visibleWhen} exists for, and this file is what proves the rule is
 * expressive enough without becoming a language.
 *
 * ## Why the bounds are here and the meanings are not
 *
 * The CRF scale's ends come from `video-compression`, which owns them; this file
 * only says which of them a slider may reach. Nothing here decides what a CRF
 * *is* or how it becomes a bitrate — a schema that reasoned about that would be
 * a second copy of the encoding policy, and the whole argument for putting that
 * policy in one pure module was that two copies drift.
 */

import { MAX_CRF, MIN_CRF } from '@/lib/engines/video-compression'
import type { VideoOptions } from '@/lib/engines/video-options'

import type { SettingsSchema, SettingsValues } from './schema'
import { visibleValues } from './values'

const MB = 1024 * 1024

/**
 * Where the quality slider stops, at each end.
 *
 * Narrower than the scale itself on purpose. CRF 0 is mathematically lossless
 * and produces a file several times larger than the source, and past about 35
 * the picture is blocky enough that nobody would keep the result — so offering
 * either is offering a setting whose only use is to waste the user's time.
 * `clampCrf` still accepts the whole scale for anything that arrives another
 * way.
 */
export const SLIDER_MIN_CRF = Math.max(MIN_CRF, 16)
export const SLIDER_MAX_CRF = Math.min(MAX_CRF, 34)

/** The four methods, and the one setting each of them carries. */
export const VIDEO_COMPRESSION_SCHEMA: SettingsSchema = {
  title: 'Compression',
  fields: [
    {
      id: 'method',
      kind: 'choice',
      label: 'How to size the result',
      default: 'quality',
      options: [
        {
          value: 'quality',
          label: 'Constant quality',
          help: 'Keeps the picture at a fixed quality and lets the size fall where it may.',
        },
        {
          value: 'target-size',
          label: 'Target file size',
          help: 'Fits the result inside a size you name. Needs to know how long the video is.',
        },
        {
          value: 'max-bitrate',
          label: 'Maximum bitrate',
          help: 'As good as it can be, but never above a rate you name.',
        },
        {
          value: 'resize',
          label: 'Smaller picture',
          help: 'Shrinks the picture itself; the rate follows the pixels.',
        },
      ],
    },
    {
      id: 'crf',
      kind: 'number',
      control: 'slider',
      label: 'Quality',
      // Stated the way the scale runs, because the number goes down as the
      // picture gets better and that surprises everyone the first time.
      help: 'Lower is better and larger. 23 is the default and is hard to tell from the source.',
      min: SLIDER_MIN_CRF,
      max: SLIDER_MAX_CRF,
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
      help: 'The finished file will come in a little under this.',
      min: 1,
      max: 4096,
      step: 1,
      default: 8,
      visibleWhen: { field: 'method', equals: ['target-size'] },
    },
    {
      id: 'maxKbps',
      kind: 'number',
      control: 'input',
      label: 'Maximum bitrate',
      unit: 'kbps',
      help: 'The rate the encoder may not exceed, even on a hard scene.',
      min: 100,
      max: 100_000,
      step: 100,
      default: 3_000,
      visibleWhen: { field: 'method', equals: ['max-bitrate'] },
    },
    {
      id: 'width',
      kind: 'number',
      control: 'input',
      label: 'Width',
      unit: 'px',
      help: 'The height follows, so the picture keeps its shape.',
      min: 16,
      max: 7680,
      step: 2,
      default: 1280,
      visibleWhen: { field: 'method', equals: ['resize'] },
    },
    {
      id: 'hardware',
      kind: 'toggle',
      label: 'Use the hardware encoder where there is one',
      help: 'Much faster. Turn it off if the result looks wrong on this machine.',
      default: true,
    },
  ],
}

/**
 * What the panel currently holds, as the engines' own options.
 *
 * Read through `visibleValues`, so a target size the user typed and then hid by
 * switching to constant quality does not travel with the job. That is the whole
 * reason the panel's state and the engine's input are different shapes.
 */
export function toVideoOptions(values: SettingsValues): VideoOptions {
  const applied = visibleValues(VIDEO_COMPRESSION_SCHEMA, values)
  const hardware = applied.hardware === true

  switch (applied.method) {
    case 'target-size':
      return {
        hardware,
        compression: { method: 'target-size', targetBytes: number(applied.targetMb) * MB },
      }

    case 'max-bitrate':
      return {
        hardware,
        compression: { method: 'max-bitrate', bitrate: number(applied.maxKbps) * 1000 },
      }

    case 'resize':
      return { hardware, compression: { method: 'resize', width: number(applied.width) } }

    default:
      return { hardware, compression: { method: 'quality', crf: number(applied.crf) } }
  }
}

/** A value that `normalise` has already made a number, narrowed for the compiler. */
function number(value: unknown): number {
  return typeof value === 'number' ? value : Number(value)
}
