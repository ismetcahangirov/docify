/**
 * A byte ceiling that holds on a stream nobody measured in advance.
 *
 * `content-length` refuses an over-large transfer before it starts, which is
 * the polite half. This is the half that actually holds: most upstreams answer
 * chunked, an upstream can simply lie, and either way the only honest ceiling
 * is one counted on the way past.
 *
 * ## Why it errors rather than truncates
 *
 * Truncating would hand the browser a file that is the right shape and the
 * wrong length — a HEIC missing its last box, a PDF missing its trailer — and
 * the engine would fail on it with a message about a corrupt file. Erroring the
 * stream makes the download fail as a download, which is a thing the caller can
 * say something true about.
 *
 * The response status is already 200 and sent by then; there is no way to
 * change it once bytes are in flight. That is HTTP, not a shortcut.
 */

/** Errors the stream once more than `maxBytes` have passed through it. */
export function limitStream(maxBytes: number): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0

  return new TransformStream<Uint8Array, Uint8Array>({
    transform(chunk, controller) {
      seen += chunk.byteLength

      if (seen > maxBytes) {
        controller.error(new Error(`The file is larger than the ${maxBytes} byte import limit.`))

        return
      }

      controller.enqueue(chunk)
    },
  })
}
