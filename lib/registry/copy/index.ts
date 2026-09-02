/**
 * Every conversion page's words, joined into one map.
 *
 * The catalogue in `lib/registry/pairs.ts` decides which pages exist; this
 * decides what each of them says. They are keyed on the same slug and
 * `test/registry/copy.test.ts` asserts the two sets are identical in both
 * directions — a pair with no copy is a page that renders empty, and copy with
 * no pair is words nobody will ever read.
 *
 * ## Why this is nineteen files and not one
 *
 * A hundred and twenty-four pages of copy is roughly twenty-five thousand
 * words. CLAUDE.md §5.2 puts a module at about three hundred lines, and one
 * file here would be nearer four thousand — unreadable, unreviewable, and
 * impossible to edit without a merge conflict. The split is by source format,
 * because that is the unit somebody actually sits down to write: all the pages
 * about what to do with an iPhone photo, together, where their overlap can be
 * seen and avoided.
 */

import { AVI_AUDIO_COPY } from './avi-audio'
import { AVI_VIDEO_COPY } from './avi'
import { AVIF_COPY } from './avif'
import { BMP_SVG_COPY } from './bmp-svg'
import { GIF_COPY } from './gif'
import { HEIC_COPY } from './heic'
import { JPG_COPY } from './jpg'
import { M4A_FLAC_COPY } from './m4a-flac'
import { MKV_AUDIO_COPY } from './mkv-audio'
import { MKV_VIDEO_COPY } from './mkv'
import { MOV_AUDIO_COPY } from './mov-audio'
import { MOV_VIDEO_COPY } from './mov'
import { MP3_COPY } from './mp3'
import { MP4_AUDIO_COPY } from './mp4-audio'
import { MP4_VIDEO_COPY } from './mp4-video'
import { OGG_AAC_COPY } from './ogg-aac'
import { PDF_COPY } from './pdf'
import { PNG_COPY } from './png'
import { TIFF_COPY } from './tiff'
import type { PairCopy } from './types'
import { WAV_COPY } from './wav'
import { WEBM_AUDIO_COPY } from './webm-audio'
import { WEBM_VIDEO_COPY } from './webm'
import { WEBP_COPY } from './webp'

/** Copy for every pair, keyed by slug. */
export const PAIR_COPY: Readonly<Record<string, PairCopy>> = Object.freeze({
  ...HEIC_COPY,
  ...JPG_COPY,
  ...PNG_COPY,
  ...WEBP_COPY,
  ...AVIF_COPY,
  ...GIF_COPY,
  ...TIFF_COPY,
  ...BMP_SVG_COPY,
  ...PDF_COPY,
  ...MP4_VIDEO_COPY,
  ...MP4_AUDIO_COPY,
  ...MOV_VIDEO_COPY,
  ...MOV_AUDIO_COPY,
  ...WEBM_VIDEO_COPY,
  ...WEBM_AUDIO_COPY,
  ...MKV_VIDEO_COPY,
  ...MKV_AUDIO_COPY,
  ...AVI_VIDEO_COPY,
  ...AVI_AUDIO_COPY,
  ...MP3_COPY,
  ...WAV_COPY,
  ...M4A_FLAC_COPY,
  ...OGG_AAC_COPY,
})

/**
 * The words for one page, or `undefined` when the slug names no page.
 *
 * `undefined` rather than a throw, for the same reason `pairBySlug` answers
 * that way: this is called with whatever arrived in the address bar, and an
 * unknown segment is a 404 rather than a crash.
 */
export function copyFor(slug: string): PairCopy | undefined {
  return PAIR_COPY[slug]
}

/**
 * Everything a page says, as one string.
 *
 * The input to the uniqueness measurement, and the reason it lives here rather
 * than in the test: what counts as "the page's text" has to be the same for the
 * CI gate and for the script a person runs by hand.
 */
export function copyText(copy: PairCopy): string {
  return [
    copy.h1,
    copy.intro,
    ...copy.steps,
    ...copy.faq.flatMap((question) => [question.q, question.a]),
    copy.note,
  ].join(' ')
}

export type { PairCopy } from './types'
