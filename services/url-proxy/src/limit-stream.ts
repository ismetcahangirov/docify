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
 *
 * ## The other ceiling is time
 *
 * A ceiling in bytes says nothing about how long they may take to arrive, and
 * an upstream that trickles one byte every 29 seconds never trips a socket idle
 * timeout either. `signal` is the deadline for the whole transfer (issue #269):
 * `proxy.ts` opens it when the response starts, and it errors the stream the
 * same way the byte ceiling does, for the same reason — a short file is worse
 * than a failed one.
 */

/**
 * Errors the stream once more than `maxBytes` have passed through it, or once
 * `signal` — the deadline for the whole transfer — has fired.
 */
export function limitStream(
  maxBytes: number,
  signal?: AbortSignal,
): TransformStream<Uint8Array, Uint8Array> {
  let seen = 0
  // A stream that has closed has no controller left to error, and calling one
  // anyway throws where nothing is listening. The deadline usually outlives a
  // healthy transfer, so this is the common path, not the corner.
  let settled = false
  let release = () => {}

  return new TransformStream<Uint8Array, Uint8Array>({
    start(controller) {
      if (signal === undefined) return

      const abandon = () => {
        if (settled) return
        settled = true
        controller.error(
          signal.reason instanceof Error
            ? signal.reason
            : new Error('The transfer did not finish in time.'),
        )
      }

      if (signal.aborted) {
        abandon()

        return
      }

      signal.addEventListener('abort', abandon, { once: true })
      release = () => signal.removeEventListener('abort', abandon)
    },

    transform(chunk, controller) {
      seen += chunk.byteLength

      if (seen > maxBytes) {
        settled = true
        release()
        controller.error(new Error(`The file is larger than the ${maxBytes} byte import limit.`))

        return
      }

      controller.enqueue(chunk)
    },

    flush() {
      settled = true
      release()
    },
  })
}
