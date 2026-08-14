/**
 * Turning the router's numbers and identifiers into the words a person reads.
 *
 * Both `route.ts` (warnings) and `rejections.ts` (refusals) put sizes and format
 * names in front of the user, and two copies of "round this to MB" is how one
 * screen ends up saying 267 MB while the next says 0.26 GB about the same file.
 */

import type { FormatId } from './types'

const KB = 1024
const MB = 1024 * KB
const GB = 1024 * MB

/** `'mp4'` → `'MP4'`, for user-facing copy. */
export function formatName(format: FormatId): string {
  return format.toUpperCase()
}

/**
 * Byte counts as a person would read them. One decimal place only in the GB
 * range, where rounding whole would hide the difference between a file slightly
 * over the limit and one nowhere near it.
 *
 * Binary units throughout: "MB" here means 1 048 576 bytes, which is what the
 * budget model counts in.
 */
export function formatBytes(bytes: number): string {
  if (bytes >= GB) return `${(bytes / GB).toFixed(1)} GB`
  if (bytes >= MB) return `${Math.round(bytes / MB)} MB`
  return `${Math.round(bytes / KB)} KB`
}
