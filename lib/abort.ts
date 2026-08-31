/**
 * The cancellation convention: what a stopped job throws, and what recognises
 * it afterwards.
 *
 * Both halves live here because they are one rule, not two. Nine engine modules
 * used to write the throw out themselves and a tenth wrote the match, which
 * gave the next abort-related change ten edit sites and no obvious first one
 * (CLAUDE.md §5.2).
 *
 * ## The rule: match the name, never the type
 *
 * `instanceof` is wrong here twice over, and each way it is wrong has already
 * cost something.
 *
 * A `DOMException` is what the platform raises for an abort, and it is what
 * {@link throwIfAborted} raises so the engines behave like the APIs around
 * them. But whether a `DOMException` is even an `Error` is runtime-dependent —
 * jsdom is a runtime where it is not — so `instanceof Error` is not safe to
 * assume of it either.
 *
 * And it does not survive the worker boundary at all. Comlink only takes the
 * error path for a value that is `instanceof Error`, so the worker converts
 * every abort into `ConversionCancelledError` (`lib/worker/errors.ts`) before
 * replying — and even that class does not arrive intact, because Comlink
 * rebuilds a generic `Error` carrying the message, name and stack. By the time
 * a cancellation reaches the main thread the only thing left of it is
 * {@link ABORT_ERROR_NAME}.
 *
 * So the name is the check. {@link isAbort} looks at nothing else, and
 * `ConversionCancelledError` exists to keep that name true across the crossing.
 *
 * ## What is deliberately not matched
 *
 * pdf.js names its own cancellation `AbortException`. It is not matched, on
 * purpose: an engine that renders rather than parses has a different thing to
 * decide about a cancelled render, and inheriting this answer silently would
 * be the wrong way to reach it. `test/lib/abort.test.ts` holds that line.
 *
 * ## Loading
 *
 * A leaf with no imports. Engines, the worker and the main thread all reach for
 * it, and none of them pays anything for it (CLAUDE.md §2.3).
 */

/** The one name a cancellation goes by, on either side of the worker. */
export const ABORT_ERROR_NAME = 'AbortError'

/** What a cancelled job says. One sentence, so the UI never has to choose. */
export const CANCELLED_MESSAGE = 'The conversion was cancelled.'

/**
 * The cancellation an engine raises when it honours its signal.
 *
 * A `DOMException`, which is what `AbortSignal.throwIfAborted` and every other
 * platform API raises, so engine code reads like the code around it. The worker
 * re-wraps it on the way out; see the module header.
 */
export function cancelled(): DOMException {
  return new DOMException(CANCELLED_MESSAGE, ABORT_ERROR_NAME)
}

/**
 * Stops here if the job has been cancelled.
 *
 * Called at each point an engine can safely give up — between files, between
 * pages, either side of an await. `AbortSignal.throwIfAborted()` would do the
 * same thing where it exists, but its reason is whatever the caller passed to
 * `abort()`, and this app's callers pass nothing; a bare `AbortError: signal is
 * aborted without reason` is not the sentence anyone wants.
 */
export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw cancelled()
}

/**
 * Whether a failure is a cancellation rather than something about the work.
 *
 * Name, never type — the module header is the argument. Written defensively
 * because it is handed whatever was caught: a rejected non-`Error`, a `null`, a
 * string.
 */
export function isAbort(reason: unknown): boolean {
  return typeof reason === 'object' && reason !== null && 'name' in reason
    ? (reason as { name: unknown }).name === ABORT_ERROR_NAME
    : false
}
