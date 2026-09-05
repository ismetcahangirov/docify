/**
 * Every conversion Docify has a page for.
 *
 * The single source of truth for the programmatic SEO surface: the static
 * routes, their metadata, their structured data, the internal linking matrix
 * and the sitemap are all generated from this list, and nothing else is allowed
 * to decide that a page exists. A pair added here appears everywhere at once; a
 * pair removed disappears everywhere at once.
 *
 * ## Every entry is a promise the router keeps
 *
 * A page for a conversion nothing can perform is the worst page in a
 * programmatic set: it ranks, somebody arrives with a file, and the app refuses
 * it. `test/registry/pairs.test.ts` routes every entry below on a capable
 * desktop and fails if any of them is refused, so the catalogue cannot drift
 * ahead of the engines. It is deliberately *narrower* than what the engines can
 * do — a pair nobody searches for is a page nobody reads.
 *
 * ## Where the copy is
 *
 * Not here. Each pair needs a distinct heading, a 40-70 word introduction,
 * three steps, four or more questions and a format-specific note, which is some
 * twenty-five thousand words in total — a single file holding both the structure
 * and the prose would be unreadable and unreviewable, and CLAUDE.md §5.2 puts
 * the ceiling at about three hundred lines. `lib/registry/copy/` holds the words,
 * keyed by the slugs minted here.
 *
 * ## Why there are no search volumes
 *
 * The obvious field is `monthlySearches`, and filling it in would mean inventing
 * a hundred and twenty-four numbers nobody measured. `demand` is the honest
 * version of the same signal: three editorial tiers, used for ordering hubs and
 * for weighting the sitemap, and nothing pretends they came from a keyword tool.
 */

import type { FormatId, Operation } from '@/lib/router/types'

import { formatMeta } from './formats'
import { pairSlug } from './slugs'

/** Roughly how much traffic a pair is expected to carry. Editorial, not measured. */
export type Demand = 'high' | 'medium' | 'low'

export interface ConversionPair {
  from: FormatId
  to: FormatId
  /** `heic-to-jpg` — the URL segment, and the key everything else joins on. */
  slug: string
  /** What the page's converter asks the router for. */
  op: Operation
  demand: Demand
}

/**
 * The targets each source format has a page for, in the order a hub lists them.
 *
 * Curated, not generated. The engines between them can perform rather more than
 * this — every audio format into every video container, for one — and a page for
 * "FLAC to AVI" would be a page about nothing. What is here is what people
 * actually convert, which is also what the copy can say something true and
 * specific about.
 */
const CATALOGUE: Readonly<Partial<Record<FormatId, readonly FormatId[]>>> = {
  // --- Photographs and graphics -------------------------------------------
  heic: ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif'],
  jpg: ['png', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf'],
  png: ['jpg', 'webp', 'avif', 'gif', 'tiff', 'bmp', 'pdf'],
  webp: ['jpg', 'png', 'avif', 'gif', 'tiff', 'bmp'],
  avif: ['jpg', 'png', 'webp', 'gif', 'tiff'],
  gif: ['jpg', 'png', 'webp', 'avif', 'tiff'],
  tiff: ['jpg', 'png', 'webp', 'avif', 'gif'],
  bmp: ['jpg', 'png', 'webp'],
  svg: ['png', 'jpg', 'webp', 'bmp'],

  // --- Documents ------------------------------------------------------------
  pdf: ['jpg', 'png', 'txt'],

  // --- Video: containers first, then the sound inside them ------------------
  mp4: ['webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg', 'flac'],
  mov: ['mp4', 'webm', 'mkv', 'avi', 'gif', 'mp3', 'wav', 'm4a', 'aac'],
  webm: ['mp4', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'wav', 'm4a', 'aac', 'ogg'],
  mkv: ['mp4', 'webm', 'mov', 'avi', 'gif', 'mp3', 'wav', 'm4a', 'aac'],
  avi: ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'wav', 'm4a'],

  // --- Audio ----------------------------------------------------------------
  mp3: ['wav', 'm4a', 'ogg', 'flac', 'aac'],
  wav: ['mp3', 'm4a', 'ogg', 'flac', 'aac'],
  m4a: ['mp3', 'wav', 'ogg', 'flac'],
  flac: ['mp3', 'wav', 'm4a', 'ogg'],
  ogg: ['mp3', 'wav', 'm4a', 'flac'],
  aac: ['mp3', 'wav', 'm4a', 'ogg'],
}

/**
 * The conversions people arrive at a converter *for*.
 *
 * Each one is somebody with a concrete problem: a photo Windows will not open,
 * a video a television will not play, a recording a transcription tool will not
 * take. They lead the hubs and carry the most weight in the sitemap.
 */
const HIGH_DEMAND: ReadonlySet<string> = new Set([
  'heic-to-jpg',
  'heic-to-png',
  'png-to-jpg',
  'jpg-to-png',
  'webp-to-jpg',
  'jpg-to-webp',
  'png-to-webp',
  'svg-to-png',
  'tiff-to-jpg',
  'avif-to-jpg',
  'bmp-to-jpg',
  'jpg-to-pdf',
  'png-to-pdf',
  'pdf-to-jpg',
  'pdf-to-png',
  'pdf-to-txt',
  'mov-to-mp4',
  'webm-to-mp4',
  'mkv-to-mp4',
  'avi-to-mp4',
  'mp4-to-webm',
  'mp4-to-gif',
  'mp4-to-mp3',
  'mov-to-mp3',
  'wav-to-mp3',
  'm4a-to-mp3',
  'flac-to-mp3',
  'ogg-to-mp3',
  'mp3-to-wav',
  'mp4-to-wav',
])

/**
 * The tail: real conversions with real demand behind them, and an order of
 * magnitude less of it.
 *
 * Mostly two kinds — an old format as a *target* rather than a source, and an
 * archival format somebody reaches for once. They still get a page, because a
 * hundred pages that each answer one person's exact question is what a
 * programmatic set is for; they simply do not lead anything.
 */
const LOW_DEMAND: ReadonlySet<string> = new Set([
  'jpg-to-bmp',
  'png-to-bmp',
  'webp-to-bmp',
  'svg-to-bmp',
  'jpg-to-gif',
  'png-to-gif',
  'webp-to-gif',
  'avif-to-gif',
  'tiff-to-gif',
  'heic-to-gif',
  'webp-to-tiff',
  'avif-to-tiff',
  'gif-to-tiff',
  'mov-to-avi',
  'webm-to-avi',
  'mkv-to-avi',
  'mp4-to-avi',
  'avi-to-mkv',
  'mov-to-mkv',
  'webm-to-mkv',
  'webm-to-mov',
  'mkv-to-mov',
  'avi-to-mov',
  'avi-to-webm',
  'mkv-to-webm',
  'mp4-to-ogg',
  'mp4-to-flac',
  'webm-to-ogg',
  'avi-to-m4a',
  'mp3-to-flac',
  'mp3-to-aac',
  'wav-to-aac',
  'ogg-to-flac',
  'm4a-to-flac',
  'flac-to-ogg',
  'aac-to-ogg',
])

function demandFor(slug: string): Demand {
  if (HIGH_DEMAND.has(slug)) return 'high'
  if (LOW_DEMAND.has(slug)) return 'low'

  return 'medium'
}

/**
 * Every pair, in catalogue order: sources in the order declared above, and each
 * source's targets in the order it lists them.
 *
 * Frozen, because a consumer sorting this in place — the sitemap by priority,
 * a hub by demand — would reorder it for the route that renders it.
 */
export const PAIRS: readonly ConversionPair[] = Object.freeze(
  Object.entries(CATALOGUE).flatMap(([source, targets]) =>
    (targets ?? []).map((to): ConversionPair => {
      const from = source as FormatId
      const slug = pairSlug(from, to)

      return { from, to, slug, op: 'convert', demand: demandFor(slug) }
    }),
  ),
)

/** Every slug, for the routes that enumerate pages at build time. */
export const PAIR_SLUGS: readonly string[] = Object.freeze(PAIRS.map((pair) => pair.slug))

const BY_SLUG: ReadonlyMap<string, ConversionPair> = new Map(PAIRS.map((pair) => [pair.slug, pair]))

/**
 * The pair a URL segment names, or `undefined` when it names none.
 *
 * `undefined` rather than a throw: this is what a static route calls with
 * whatever arrived in the address bar, and an unknown segment is a 404 rather
 * than a crash.
 */
export function pairBySlug(slug: string): ConversionPair | undefined {
  return BY_SLUG.get(slug)
}

/**
 * The conversions people arrive at a converter for, in catalogue order.
 *
 * What the home page leads with (issue #267): the whole of `HIGH_DEMAND` and
 * nothing from the tail, so that the first screen answers the questions most
 * people bring rather than the ones a catalogue happens to start with.
 */
export function popularPairs(): readonly ConversionPair[] {
  return PAIRS.filter((pair) => pair.demand === 'high')
}

/** Every pair that starts from `format`, in catalogue order. */
export function pairsFrom(format: FormatId): readonly ConversionPair[] {
  return PAIRS.filter((pair) => pair.from === format)
}

/** Every pair that ends at `format`, in catalogue order. */
export function pairsTo(format: FormatId): readonly ConversionPair[] {
  return PAIRS.filter((pair) => pair.to === format)
}

/** Every format that appears on either side of at least one pair. */
export function formatsWithPages(): readonly FormatId[] {
  const seen = new Set<FormatId>()

  for (const pair of PAIRS) {
    seen.add(pair.from)
    seen.add(pair.to)
  }

  return [...seen]
}

/**
 * `HEIC to JPG` — the conversion named the way a page's copy names it.
 *
 * Here rather than in each consumer because it is the phrase the H1, the title,
 * the breadcrumb and every internal link have to agree on.
 */
export function pairTitle(pair: ConversionPair): string {
  return `${formatMeta(pair.from).name} to ${formatMeta(pair.to).name}`
}
