/**
 * Which formats wasm-vips can read and write, and how to ask it.
 *
 * Split out of `./vips.ts` so the engine file holds behaviour and this one holds
 * the tables. Everything here is derived from what is actually compiled into
 * wasm-vips 0.0.18 (libvips 8.18.3) — not from what libvips supports in general.
 * A format libvips could handle with a loader we did not build is a runtime
 * failure with a useless message, so the sets below stay conservative.
 */

import type { FormatId, Operation } from '@/lib/router/types'

import { type ImageOptions, resolveQuality } from './image-options'

/**
 * Formats the vendored build can decode.
 *
 * `bmp` and `ico` are absent because libvips reads neither without ImageMagick,
 * and `svg` because that loader lives in the `vips-resvg.wasm` side module,
 * which is not vendored — Canvas renders SVG natively and for free.
 */
export const VIPS_READABLE: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
  'heic',
])

/**
 * Formats the vendored build can encode.
 *
 * HEIC is read-only: writing it needs an HEVC encoder, and the build ships AOM
 * for AV1 only — so `.avif` saves and `.heic` does not.
 */
export const VIPS_WRITABLE: ReadonlySet<FormatId> = new Set<FormatId>([
  'jpg',
  'png',
  'webp',
  'avif',
  'gif',
  'tiff',
])

/**
 * Operations this engine implements.
 *
 * `crop`, `rotate` and the rest of the geometry family land with issue 4.5;
 * claiming them here would route work to a runner that ignores them.
 */
export const VIPS_OPERATIONS: ReadonlySet<Operation> = new Set<Operation>([
  'convert',
  'compress',
  'resize',
])

/** Formats whose codec lives in the `vips-heif.wasm` side module. */
export const VIPS_HEIF_FORMATS: ReadonlySet<FormatId> = new Set<FormatId>(['avif', 'heic'])

/** The suffix libvips picks a saver from. `.avif` selects heifsave with AV1. */
const SAVE_SUFFIX: Partial<Record<FormatId, string>> = {
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
  gif: '.gif',
  tiff: '.tif',
}

const MIME_TYPE: Partial<Record<FormatId, string>> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  avif: 'image/avif',
  gif: 'image/gif',
  tiff: 'image/tiff',
}

/** Formats where the `Q` parameter means anything. */
const LOSSY_OUTPUT: ReadonlySet<FormatId> = new Set<FormatId>(['jpg', 'webp', 'avif'])

/**
 * PNG deflate effort.
 *
 * 6 is zlib's own default and the knee of the curve: 9 costs roughly twice the
 * time for under a percent of size on photographic content, which is a bad trade
 * in a tab the user is watching.
 */
const PNG_COMPRESSION = 6

export function saveSuffix(format: FormatId): string {
  const suffix = SAVE_SUFFIX[format]
  if (suffix === undefined) throw new Error(`wasm-vips cannot write ${format.toUpperCase()}.`)

  return suffix
}

export function mimeType(format: FormatId): string {
  return MIME_TYPE[format] ?? 'application/octet-stream'
}

/** Whether running this pair needs the HEIF side module downloaded. */
export function needsHeifModule(from: FormatId, to: FormatId): boolean {
  return VIPS_HEIF_FORMATS.has(from) || VIPS_HEIF_FORMATS.has(to)
}

/**
 * The save options for one output format.
 *
 * `keep` is always stated rather than left to libvips' default, because the
 * default is "keep everything" and holiday photos carry GPS coordinates. See
 * `ImageOptions.keepMetadata`.
 */
export function saveOptions(
  format: FormatId,
  options: ImageOptions | undefined,
): Record<string, unknown> {
  const common: Record<string, unknown> = { keep: options?.keepMetadata === true ? 'all' : 'none' }

  if (LOSSY_OUTPUT.has(format)) return { ...common, Q: resolveQuality(options) }
  if (format === 'png') return { ...common, compression: PNG_COMPRESSION }
  // Deflate is lossless, universally readable, and roughly halves a photographic
  // TIFF. The alternative worth having is none at all, which nobody asks for.
  if (format === 'tiff') return { ...common, compression: 'deflate' }

  return common
}
