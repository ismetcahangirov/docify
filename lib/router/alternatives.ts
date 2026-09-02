/**
 * What else this device could do with the file.
 *
 * CLAUDE.md §2.5 makes a rejection explain itself, and `./rejections` writes
 * that explanation. This module answers the question the explanation raises
 * next: *then what can I do?* A refusal that ends with "convert it to PNG
 * instead", where PNG is a conversion this browser has already been asked about
 * and agreed to, is the difference between a dead end and a detour.
 *
 * ## Everything is verified, nothing is assumed
 *
 * An alternative is only offered once `route()` has returned `ok` for it — same
 * sizes, same device, same operation. Reading the table below and offering its
 * contents unchecked would produce exactly the failure this exists to prevent:
 * a second suggestion the browser also refuses, found out with a second drop.
 *
 * That is also why the size ceiling takes care of itself. A 4 GB video refused
 * for memory is refused for memory in every container, so `route()` turns every
 * candidate down and the caller correctly gets nothing to offer.
 *
 * Pure, like the rest of `lib/router`: `Capabilities` is a parameter and the
 * file is never opened.
 */

import { route } from './route'
import type { Capabilities, ConversionTask, FormatId, RouteInput } from './types'

/**
 * How many alternatives are worth showing.
 *
 * Three. A rejection is already bad news, and a list of nine formats under it
 * is a second decision at the worst moment; the table below is ordered so the
 * first three are the ones people actually want.
 */
const DEFAULT_LIMIT = 3

/**
 * The targets worth trying for each source, most wanted first.
 *
 * Judgement, not capability: what somebody holding this kind of file plausibly
 * wants instead, in the order they would want it. Whether any given entry is
 * *possible* is not this table's business — `route()` decides that, on the
 * actual device, and prunes what it will not run.
 *
 * The orderings encode the obvious asymmetries. Somebody with a HEIC wants a
 * JPEG, because the reason they are here is that Windows will not open the
 * file; somebody with a PNG wants a JPEG for size and a WebP for the web, and
 * almost never a BMP. A video's own containers come before the audio it
 * contains, because a container change is what "convert this video" usually
 * means.
 *
 * Archive formats map to nothing: no engine claims them yet, so every candidate
 * would be pruned and an empty list says so more honestly than a wrong one.
 */
const PREFERRED_TARGETS: Readonly<Record<FormatId, readonly FormatId[]>> = {
  jpg: ['png', 'webp', 'pdf', 'avif', 'tiff', 'gif', 'bmp'],
  png: ['jpg', 'webp', 'pdf', 'avif', 'tiff', 'gif', 'bmp'],
  webp: ['jpg', 'png', 'avif', 'tiff', 'gif', 'bmp'],
  avif: ['jpg', 'png', 'webp', 'tiff', 'gif'],
  gif: ['png', 'jpg', 'webp', 'avif', 'tiff'],
  bmp: ['png', 'jpg', 'webp'],
  tiff: ['jpg', 'png', 'webp', 'avif', 'gif'],
  svg: ['png', 'jpg', 'webp', 'bmp'],
  heic: ['jpg', 'png', 'webp', 'avif', 'tiff', 'gif'],
  ico: ['png', 'jpg', 'webp'],
  pdf: ['jpg', 'png', 'txt'],
  txt: ['pdf'],
  mp4: ['webm', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'm4a', 'wav'],
  webm: ['mp4', 'mov', 'mkv', 'avi', 'gif', 'mp3', 'm4a', 'wav'],
  mov: ['mp4', 'webm', 'mkv', 'avi', 'gif', 'mp3', 'm4a', 'wav'],
  mkv: ['mp4', 'webm', 'mov', 'avi', 'gif', 'mp3', 'm4a'],
  avi: ['mp4', 'webm', 'mov', 'mkv', 'gif', 'mp3', 'm4a'],
  mp3: ['wav', 'm4a', 'ogg', 'flac', 'aac'],
  wav: ['mp3', 'm4a', 'ogg', 'flac', 'aac'],
  ogg: ['mp3', 'wav', 'm4a', 'flac', 'aac'],
  m4a: ['mp3', 'wav', 'ogg', 'flac', 'aac'],
  flac: ['mp3', 'wav', 'm4a', 'ogg', 'aac'],
  aac: ['mp3', 'wav', 'm4a', 'ogg', 'flac'],
  zip: [],
  rar: [],
  '7z': [],
  tar: [],
}

/**
 * Conversions of the same file, with the same operation, that this device would
 * accept — at most `limit` of them, most wanted first.
 *
 * `input` must be the sizes the refused job was routed with. Anything else and
 * the answer is about a different job: the memory budget is most of what makes
 * a candidate viable, and a suggestion measured against one byte is a suggestion
 * about nothing.
 */
export function alternativeTargets(
  task: ConversionTask,
  input: RouteInput,
  caps: Capabilities,
  limit: number = DEFAULT_LIMIT,
): readonly ConversionTask[] {
  const found: ConversionTask[] = []

  for (const to of PREFERRED_TARGETS[task.from]) {
    if (found.length >= limit) break
    // Neither is an alternative to anything: one is what was just refused, and
    // the other is the file the user already has.
    if (to === task.to || to === task.from) continue

    const candidate: ConversionTask = { ...task, to }
    if (route(candidate, input, caps).ok) found.push(candidate)
  }

  return found
}
