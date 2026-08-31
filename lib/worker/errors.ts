/**
 * The one thing a cancelled job rejects with.
 *
 * The web platform's answer to "this was aborted" is a `DOMException` named
 * `AbortError`, and that is what an engine throws when it honours its signal.
 * It is the wrong thing to send across a worker boundary, though. Comlink only
 * takes the error path for a value that is `instanceof Error`, and whether a
 * `DOMException` satisfies that depends on the runtime: modern browsers say
 * yes, other environments — jsdom among them — say no, and there the exception
 * falls through to the structured-clone path and arrives as a bare `{}`. A
 * cancellation the caller cannot recognise is worse than no cancellation at
 * all; it looks like a crash.
 *
 * So the worker converts every abort into this before it replies. It is a plain
 * `Error` subclass, which every runtime serialises the same way, and it keeps
 * the abort name so the check on the far side stays the idiomatic one — the
 * one `isAbort` in `lib/abort.ts` performs.
 * The class itself does not survive the crossing — Comlink rebuilds a generic
 * `Error` carrying the message, name and stack — so callers match on `name`,
 * never with `instanceof`. `lib/abort.ts` owns that rule and both constants
 * below; this class exists only to keep the name true across the boundary.
 */

import { ABORT_ERROR_NAME, CANCELLED_MESSAGE } from '@/lib/abort'

export class ConversionCancelledError extends Error {
  constructor(message = CANCELLED_MESSAGE, options?: ErrorOptions) {
    super(message, options)
    this.name = ABORT_ERROR_NAME
  }
}
