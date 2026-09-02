/**
 * One download for a whole batch.
 *
 * Twenty converted photos is twenty clicks and twenty "keep / discard" prompts,
 * which is the point at which people stop using a batch converter. This packs
 * them into a single archive.
 *
 * ## Why the zipper is asynchronous, and injected
 *
 * fflate ships both. `zipSync` would be four lines shorter and would run a
 * few-hundred-megabyte memcpy on the main thread, freezing the tab it happened
 * in — CLAUDE.md §2.2 is about the UI never blocking, and it does not stop
 * applying because the bytes have already been converted. The asynchronous
 * `zip` does the same work on a thread of its own.
 *
 * It arrives as a parameter so a test can drive the whole path without fflate
 * and without a `Worker`, and so the default can stay a `dynamic import()` —
 * fflate is not in any page's initial bundle and must not be pulled into one for
 * a button most visitors never press (CLAUDE.md §2.3).
 */

import type { ConversionResult } from './results'

/** Entry name to bytes, which is the shape fflate's `zip` takes. */
export type ZipEntries = Record<string, Uint8Array>

/** Packs `entries` and answers with the archive's bytes. */
export type Zipper = (entries: ZipEntries) => Promise<Uint8Array<ArrayBuffer>>

/**
 * Stored, not deflated.
 *
 * Everything here is already compressed — JPEG, PNG, PDF streams and every video
 * container carry their own codecs — so deflating a second time spends seconds
 * of CPU to save a fraction of a percent, and occasionally makes the archive
 * larger. The same reasoning as `toZip` in `lib/engines/zip-output.ts`.
 */
const STORED = 0

/**
 * The results as one ZIP.
 *
 * Entry names come straight off the results, which had their collisions settled
 * when the list was built — see `./results`. Deriving them again here is how the
 * archive ends up disagreeing with the links beside it.
 */
export async function zipResults(
  results: readonly ConversionResult[],
  zip: Zipper = fflateZipper,
): Promise<Blob> {
  if (results.length === 0) {
    // A zero-entry archive downloads, opens, and shows the user nothing. The
    // button that reaches this is hidden below two results, so arriving here is
    // a bug worth naming rather than a file worth shipping.
    throw new Error('Refusing to write an empty ZIP: there are no converted files to pack.')
  }

  const entries: ZipEntries = {}

  for (const result of results) {
    entries[result.name] = new Uint8Array(await result.blob.arrayBuffer())
  }

  return new Blob([await zip(entries)], { type: 'application/zip' })
}

/**
 * The real zipper: fflate's asynchronous `zip`, loaded on first use.
 *
 * Callback-shaped, so it is wrapped rather than awaited. `zip` returns an
 * aborter we deliberately drop: a batch archive at level 0 is memcpy-fast, and
 * there is no cancel affordance in front of it to wire one up to.
 */
async function fflateZipper(entries: ZipEntries): Promise<Uint8Array<ArrayBuffer>> {
  const { zip } = await import('fflate')

  return new Promise((resolve, reject) => {
    zip(entries, { level: STORED }, (error, data) => {
      if (error) reject(error)
      // fflate always allocates a plain ArrayBuffer; its published type is the
      // wider `ArrayBufferLike`, which `Blob` will not take.
      else resolve(data as Uint8Array<ArrayBuffer>)
    })
  })
}
