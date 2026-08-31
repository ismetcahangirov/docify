/**
 * Putting a JPEG's metadata back after the canvas has thrown it away.
 *
 * A separate module from `./canvas-runner` for the same reason `./canvas-svg`
 * is: the runner is one pipeline — decode, draw, encode — and both of these are
 * a *format's* business hanging off one end of it. Together in the runner they
 * would put it past the size rule (CLAUDE.md §5.2) and bury the pipeline in
 * special cases.
 */

import { preservesMetadata } from './canvas'
import { METADATA_SCAN_BYTES, readMetadataSegments, withMetadataSegments } from './jpeg-metadata'
import type { EngineInput } from './types'

/**
 * The encoded output with the source's Exif, ICC, XMP and IPTC restored, where
 * the job asked for them and the pair allows it.
 *
 * A no-op in every other case, which is most of them. A canvas decodes to RGBA
 * and encodes from scratch, so everything that was not a pixel is already gone —
 * that *is* the strip half of the toggle, and it is the default
 * (`ImageOptions.keepMetadata`) because holiday photos carry GPS coordinates.
 *
 * Only a JPEG can receive the segments back: see `preservesMetadata` in
 * `./canvas` for why, and for why the router can still send a keep-metadata job
 * here that this cannot honour.
 *
 * Only the first {@link METADATA_SCAN_BYTES} of the source are read. The answer
 * is in the file's first few kilobytes, and pulling a 50 MB photograph into
 * memory to find it would cost more than the conversion did.
 */
export async function carryMetadata(source: Blob, output: Blob, input: EngineInput): Promise<Blob> {
  if (input.image?.keepMetadata !== true) return output
  // `slice` is universal in a browser, but `EngineInput` only promises a `Blob`,
  // and one that has crossed a structured clone in a host with partial support
  // arrives as data without methods. Abstaining drops the metadata, which is the
  // safe direction — the same judgement `./canvas-runner` makes about headers.
  if (!preservesMetadata(input.task) || typeof source.slice !== 'function') return output

  const head = new Uint8Array(await source.slice(0, METADATA_SCAN_BYTES).arrayBuffer())
  const segments = readMetadataSegments(head)
  if (segments.length === 0) return output

  const encoded = new Uint8Array(await output.arrayBuffer())

  return new Blob([withMetadataSegments(encoded, segments)], { type: output.type })
}
