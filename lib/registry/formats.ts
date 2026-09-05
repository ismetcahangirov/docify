/**
 * What each file format *is*, in the words a page uses about it.
 *
 * The router knows formats as identifiers it can compare; this knows them as
 * things a person has on their disk and has an opinion about. Every page in the
 * programmatic SEO surface — the pair pages, their metadata, their structured
 * data, the format hubs — draws its nouns from here, so that "HEIC" is spelled,
 * expanded and described the same way on all hundred and twenty of them.
 *
 * Kept apart from `lib/engines/*`'s own format tables on purpose. Those answer
 * "can this engine read it"; a format's name, its MIME type and the sentence
 * that explains it are true whether or not anything can open it, and an entry
 * here is not a claim that a conversion exists. `./pairs` makes that claim, and
 * only for combinations `route()` has agreed to.
 */

import type { FormatId } from '@/lib/router/types'

/** The family a format belongs to, which is what groups the hub pages. */
export type FormatKind = 'image' | 'document' | 'video' | 'audio' | 'archive'

export interface FormatMeta {
  id: FormatId
  /** How the format is written in a sentence: `HEIC`, `JPG`, `MP4`. */
  name: string
  /** What the acronym stands for, spelled out once per page for the reader. */
  fullName: string
  /** The suffix its files carry, leading dot included. */
  extension: string
  /** The IANA media type, used in structured data and in `accept` attributes. */
  mime: string
  /**
   * The other spellings of this same format that a file picker has to show.
   *
   * Extensions and media types both, because an OS picker filters on whichever
   * of the two it has. A format is one thing on disk and several things in a
   * file name: the same HEIF container is `.heic` off an iPhone and `.heif` off
   * an Android export, and a picker built from the canonical suffix alone hides
   * the second behind "All files" — which reads as the tool not supporting the
   * file (issue #272).
   *
   * Only what changes the picker. The engines sniff bytes and never consult
   * this, so an alias is a claim about what people have on disk rather than
   * about what can be decoded. Where a format really has one spelling, the
   * field is absent rather than an empty array.
   */
  aliases?: readonly string[]
  kind: FormatKind
  /**
   * One sentence about what the format is for.
   *
   * Written to be quotable inside a page's copy rather than to be exhaustive:
   * the thing about the format that explains why somebody is converting it.
   */
  summary: string
}

const META: Readonly<Record<FormatId, Omit<FormatMeta, 'id'>>> = {
  jpg: {
    name: 'JPG',
    fullName: 'Joint Photographic Experts Group',
    extension: '.jpg',
    mime: 'image/jpeg',
    // The spelling from before eight-character file names, which never went away.
    aliases: ['.jpeg'],
    kind: 'image',
    summary:
      'The oldest photographic format still in daily use, and the one every camera, phone, printer and website accepts without asking.',
  },
  png: {
    name: 'PNG',
    fullName: 'Portable Network Graphics',
    extension: '.png',
    mime: 'image/png',
    kind: 'image',
    summary:
      'Lossless, and the only widely-supported format that keeps a transparent background intact, which is why logos and screenshots live in it.',
  },
  webp: {
    name: 'WebP',
    fullName: 'Web Picture format',
    extension: '.webp',
    mime: 'image/webp',
    kind: 'image',
    summary:
      'Google’s web format: roughly a third smaller than JPG at the same visible quality, with transparency and animation built in.',
  },
  avif: {
    name: 'AVIF',
    fullName: 'AV1 Image File Format',
    extension: '.avif',
    mime: 'image/avif',
    kind: 'image',
    summary:
      'The AV1 video codec applied to a still picture. The smallest of the modern web formats, and the slowest to encode.',
  },
  gif: {
    name: 'GIF',
    fullName: 'Graphics Interchange Format',
    extension: '.gif',
    mime: 'image/gif',
    kind: 'image',
    summary:
      'Limited to 256 colours and still the only animation format that plays everywhere without a video player.',
  },
  bmp: {
    name: 'BMP',
    fullName: 'Bitmap image file',
    extension: '.bmp',
    mime: 'image/bmp',
    kind: 'image',
    summary:
      'Uncompressed Windows bitmap. Enormous by modern standards, and still what a lot of industrial and medical software writes.',
  },
  tiff: {
    name: 'TIFF',
    fullName: 'Tagged Image File Format',
    extension: '.tif',
    mime: 'image/tiff',
    // What every scanner and every image editor actually writes.
    aliases: ['.tiff'],
    kind: 'image',
    summary:
      'The archival and print format: lossless, multi-page, and the default output of most document scanners.',
  },
  svg: {
    name: 'SVG',
    fullName: 'Scalable Vector Graphics',
    extension: '.svg',
    mime: 'image/svg+xml',
    kind: 'image',
    summary:
      'Not pixels at all but drawing instructions, so it stays sharp at any size — and needs rasterising before most software will take it.',
  },
  heic: {
    name: 'HEIC',
    fullName: 'High Efficiency Image Container',
    extension: '.heic',
    mime: 'image/heic',
    // The same container under its standard name: Android exports and macOS
    // both write `.heif`, and an iPhone photo is the only thing that is `.heic`.
    aliases: ['.heif', 'image/heif'],
    kind: 'image',
    summary:
      'What an iPhone has written since iOS 11. About half the size of the equivalent JPG, and unopenable on a great deal of software.',
  },
  ico: {
    name: 'ICO',
    fullName: 'Windows Icon',
    extension: '.ico',
    mime: 'image/x-icon',
    kind: 'image',
    summary:
      'A container holding the same icon at several sizes at once, used for Windows shortcuts and website favicons.',
  },
  pdf: {
    name: 'PDF',
    fullName: 'Portable Document Format',
    extension: '.pdf',
    mime: 'application/pdf',
    kind: 'document',
    summary:
      'A page description rather than a document: it fixes the layout so that a file looks the same on every machine that opens it.',
  },
  txt: {
    name: 'TXT',
    fullName: 'Plain text',
    extension: '.txt',
    mime: 'text/plain',
    kind: 'document',
    summary:
      'Characters and nothing else — no fonts, no layout, no images. Every program on earth can read it.',
  },
  mp4: {
    name: 'MP4',
    fullName: 'MPEG-4 Part 14',
    extension: '.mp4',
    mime: 'video/mp4',
    kind: 'video',
    summary:
      'The universal video container. If a device plays video at all, it plays H.264 in an MP4.',
  },
  webm: {
    name: 'WebM',
    fullName: 'WebM',
    extension: '.webm',
    mime: 'video/webm',
    kind: 'video',
    summary:
      'Google’s royalty-free container for the web, holding VP9 or AV1 video and Opus audio.',
  },
  mov: {
    name: 'MOV',
    fullName: 'QuickTime File Format',
    extension: '.mov',
    mime: 'video/quicktime',
    kind: 'video',
    summary:
      'Apple’s container and what an iPhone camera records into. Structurally almost identical to MP4, and treated as a foreign format by a lot of Windows software.',
  },
  mkv: {
    name: 'MKV',
    fullName: 'Matroska Video',
    extension: '.mkv',
    mime: 'video/x-matroska',
    kind: 'video',
    summary:
      'The container that holds anything — any codec, any number of subtitle and audio tracks — and that most consumer hardware refuses to play.',
  },
  avi: {
    name: 'AVI',
    fullName: 'Audio Video Interleave',
    extension: '.avi',
    mime: 'video/x-msvideo',
    kind: 'video',
    summary:
      'Microsoft’s container from 1992. Still turns up in camcorder footage and old archives, and has no modern streaming support at all.',
  },
  mp3: {
    name: 'MP3',
    fullName: 'MPEG-1 Audio Layer III',
    extension: '.mp3',
    mime: 'audio/mpeg',
    kind: 'audio',
    summary:
      'The format that made digital music portable, and the one every player, car stereo and phone still supports without exception.',
  },
  wav: {
    name: 'WAV',
    fullName: 'Waveform Audio File Format',
    extension: '.wav',
    mime: 'audio/wav',
    kind: 'audio',
    summary:
      'Raw uncompressed audio. Perfect quality, roughly ten megabytes a minute, and what every editing and transcription tool wants as input.',
  },
  ogg: {
    name: 'OGG',
    fullName: 'Ogg container',
    extension: '.ogg',
    mime: 'audio/ogg',
    kind: 'audio',
    summary:
      'An open container, in practice holding Opus or Vorbis. Standard in games and on the open web, largely absent from consumer hardware.',
  },
  m4a: {
    name: 'M4A',
    fullName: 'MPEG-4 Audio',
    extension: '.m4a',
    mime: 'audio/mp4',
    kind: 'audio',
    summary:
      'AAC audio in an MP4 container: what iTunes, Apple Music and voice memos produce, and better than MP3 at the same bitrate.',
  },
  flac: {
    name: 'FLAC',
    fullName: 'Free Lossless Audio Codec',
    extension: '.flac',
    mime: 'audio/flac',
    kind: 'audio',
    summary:
      'Lossless compression: bit-for-bit the original recording at about half the size of a WAV, which is why archives and hi-fi libraries use it.',
  },
  aac: {
    name: 'AAC',
    fullName: 'Advanced Audio Coding',
    extension: '.aac',
    mime: 'audio/aac',
    kind: 'audio',
    summary:
      'The successor to MP3 and the audio inside almost every MP4. As a bare `.aac` file it is a raw stream with no container around it.',
  },
  zip: {
    name: 'ZIP',
    fullName: 'ZIP archive',
    extension: '.zip',
    mime: 'application/zip',
    kind: 'archive',
    summary: 'The archive format every operating system opens without installing anything.',
  },
  rar: {
    name: 'RAR',
    fullName: 'Roshal Archive',
    extension: '.rar',
    mime: 'application/vnd.rar',
    kind: 'archive',
    summary:
      'A proprietary archive with better compression than ZIP and no free way to create one.',
  },
  '7z': {
    name: '7Z',
    fullName: '7-Zip archive',
    extension: '.7z',
    mime: 'application/x-7z-compressed',
    kind: 'archive',
    summary: 'An open archive format with the strongest general-purpose compression in common use.',
  },
  tar: {
    name: 'TAR',
    fullName: 'Tape Archive',
    extension: '.tar',
    mime: 'application/x-tar',
    kind: 'archive',
    summary:
      'A container that concatenates files without compressing them, which is why it usually arrives paired with gzip.',
  },
}

/** Every format, keyed by id. */
export const FORMATS: Readonly<Record<FormatId, FormatMeta>> = Object.freeze(
  Object.fromEntries(
    Object.entries(META).map(([id, meta]) => [id, { id: id as FormatId, ...meta }]),
  ) as Record<FormatId, FormatMeta>,
)

/**
 * Every format, in a fixed order.
 *
 * Declaration order, which groups the families together and puts the formats
 * people arrive with in front of the ones they leave with. Anything that lists
 * formats — a hub index, a sitemap section — reads this rather than sorting the
 * keys, so the order is a decision made once instead of an accident of `Object`.
 */
export const ALL_FORMATS: readonly FormatMeta[] = Object.freeze(Object.values(FORMATS))

/** The metadata for `id`. Total by construction, so it cannot answer `undefined`. */
export function formatMeta(id: FormatId): FormatMeta {
  return FORMATS[id]
}

/** Every format in one family, in the order of {@link ALL_FORMATS}. */
export function formatsOfKind(kind: FormatKind): readonly FormatMeta[] {
  return ALL_FORMATS.filter((format) => format.kind === kind)
}

/**
 * What to put in an `<input type="file">`'s `accept`, for a picker that shows
 * every file this format actually arrives as.
 *
 * The media type first, then the canonical extension, then the aliases — a
 * picker lists them in the order it is given, and the canonical spelling is the
 * one the page is about. Deduplicated because a repeated token is a repeated
 * row in some pickers.
 *
 * `accept` is a filter on what the user can *see*, never a check on what is
 * allowed: a browser applies it loosely, a drag-and-drop bypasses it entirely,
 * and the engines sniff bytes regardless. Widening it therefore cannot let
 * anything through that was not already coming through — it only stops hiding a
 * file the user is looking straight at (issue #272).
 */
export function acceptFor(format: FormatMeta): string {
  return [...new Set([format.mime, format.extension, ...(format.aliases ?? [])])].join(',')
}
