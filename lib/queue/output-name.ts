/**
 * What a converted file is called.
 *
 * The stem is the user's and never changes: they recognise `IMG_4021` and they
 * do not recognise `converted-3`. Only the extension moves, because that is the
 * one part of the name the conversion actually invalidated — a JPEG called
 * `.heic` is a file every operating system opens with the wrong application.
 *
 * Pure, and separate from the panel that renders it, so the collision rule a ZIP
 * depends on can be settled once and asserted without a DOM.
 */

import type { FormatId } from '@/lib/router/types'

/**
 * The suffix a file of each format is normally written with.
 *
 * One entry per `FormatId`, and `Record` rather than `Partial<Record>` on
 * purpose: adding a format to the union without deciding what its files are
 * called is a compile error here rather than a `.undefined` on somebody's
 * download.
 *
 * Two entries are choices rather than facts. `jpg` writes `.jpg` and not
 * `.jpeg`, and `tiff` writes `.tif` and not `.tiff`: both are the short form
 * every writer emits, and both are what the source file being converted almost
 * always arrived as.
 */
const EXTENSION: Readonly<Record<FormatId, string>> = {
  jpg: '.jpg',
  png: '.png',
  webp: '.webp',
  avif: '.avif',
  gif: '.gif',
  bmp: '.bmp',
  tiff: '.tif',
  svg: '.svg',
  heic: '.heic',
  ico: '.ico',
  pdf: '.pdf',
  txt: '.txt',
  mp4: '.mp4',
  webm: '.webm',
  mov: '.mov',
  mkv: '.mkv',
  avi: '.avi',
  mp3: '.mp3',
  wav: '.wav',
  ogg: '.ogg',
  m4a: '.m4a',
  flac: '.flac',
  aac: '.aac',
  zip: '.zip',
  rar: '.rar',
  '7z': '.7z',
  tar: '.tar',
}

/** The file extension for `format`, leading dot included. */
export function extensionOf(format: FormatId): string {
  return EXTENSION[format]
}

/** Used when a file arrives with no usable name — a paste, mostly. */
const FALLBACK_STEM = 'converted'

/**
 * `source` with its extension replaced by `to`'s.
 *
 * Three cases the obvious `split('.')` gets wrong, and all three arrive in
 * practice:
 *
 * - `report.final.v2.png` — only the *last* extension is the extension.
 * - `.profile` — a leading dot is part of the name, not a suffix in front of an
 *   empty stem.
 * - `holiday/2024/beach.heic` — a folder drop carries its path in
 *   `File.name` via `webkitRelativePath`, and a `/` in a ZIP entry silently
 *   creates a directory.
 */
export function outputName(source: string, to: FormatId): string {
  const base = source.split(/[/\\]/).pop() ?? ''
  const trimmed = base.trim()
  const stem = trimmed.length === 0 ? FALLBACK_STEM : withoutExtension(trimmed)

  return `${stem}${extensionOf(to)}`
}

/** `name` up to its last dot, or all of it when there is nothing to strip. */
function withoutExtension(name: string): string {
  const dot = name.lastIndexOf('.')

  // `dot <= 0` covers both "no dot at all" and a dotfile, where the dot is at
  // index 0 and the whole string is the stem.
  return dot <= 0 ? name : name.slice(0, dot)
}
