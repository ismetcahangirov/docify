/**
 * The multi-file result format.
 *
 * Several conversions produce more than one file from one input — a PDF split
 * into its pages, a PDF rendered to one JPG per page — while `EngineRunner.run`
 * answers with a single `Blob`. This module is the join between the two, and it
 * lives here rather than inside either engine so that the two never disagree
 * about entry naming or compression.
 *
 * It is *not* the `zip` engine of `EngineId`. That one is a user-facing archive
 * converter with its own descriptor and its own routing; this is a helper the
 * PDF engines call on their way out.
 */

import { zipSync } from 'fflate'

export interface ZipEntry {
  /** The file name inside the archive, extension included. */
  name: string
  bytes: Uint8Array
}

/**
 * Packs `entries` into a ZIP.
 *
 * Stored, not deflated (`level: 0`). Everything that reaches this function is
 * already compressed — PDF streams are Flate-encoded, JPEG and PNG carry their
 * own codecs — so deflating a second time spends seconds of a phone's CPU to
 * save a fraction of a percent, and occasionally makes the archive larger.
 *
 * Synchronous because the alternative is worse here: `zipSync` on a few hundred
 * stored megabytes is memory-bound rather than CPU-bound, and this already runs
 * on the worker thread, so the UI cannot freeze (CLAUDE.md §2.2).
 */
export function toZip(entries: readonly ZipEntry[]): Blob {
  if (entries.length === 0) {
    // A zero-entry archive downloads, opens, and shows the user nothing. The
    // caller has a bug — an empty page range, a filtered-out selection — and
    // saying so here beats shipping a file that looks like success.
    throw new Error('Refusing to write an empty ZIP: the conversion produced no files.')
  }

  const packed = zipSync(Object.fromEntries(entries.map((entry) => [entry.name, entry.bytes])), {
    level: 0,
  })

  return new Blob([packed], { type: 'application/zip' })
}

/**
 * `name`, or the first `-2`, `-3`, ... variant of it that `taken` does not hold.
 *
 * ZIP entries are keyed by name and a duplicate silently replaces its
 * predecessor, so two source files called `scan.pdf` would arrive as one entry.
 * The suffix goes before the extension, where a person reading a file list
 * expects it.
 *
 * Does not mutate `taken`; the caller adds the returned name once it commits.
 */
export function uniqueEntryName(name: string, taken: ReadonlySet<string>): string {
  if (!taken.has(name)) return name

  const dot = name.lastIndexOf('.')
  const [stem, extension] = dot <= 0 ? [name, ''] : [name.slice(0, dot), name.slice(dot)]

  for (let suffix = 2; ; suffix += 1) {
    const candidate = `${stem}-${suffix}${extension}`
    if (!taken.has(candidate)) return candidate
  }
}
