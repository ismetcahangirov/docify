/**
 * Turns an engine's progress stream into something worth sending across a
 * thread boundary.
 *
 * Two opposite failure modes meet here. An engine that reports per frame can
 * emit thousands of ticks a second, and every one of them is a `postMessage`
 * plus a React render on the main thread — the exact main-thread flooding
 * CLAUDE.md §2.2 moves the work off the main thread to avoid. An engine that
 * goes quiet mid-file leaves a progress bar frozen, which reads as a crash.
 *
 * So the relay does both jobs at once: it coalesces bursts down to one message
 * per window, and it keeps sending on the window boundary even when nothing new
 * arrived. The result is a stream that is never denser than one message per
 * `intervalMs` and never sparser either, which is the 250 ms guarantee from
 * `lib/engines/types.ts` made true of the protocol rather than merely asked of
 * each engine.
 */

import type { ProgressCallback } from '@/lib/engines/types'

/**
 * The contract from `lib/engines/types.ts`, in one place.
 *
 * Chosen for perception, not for the renderer: a bar that moves four times a
 * second reads as alive, and anything faster is spent on frames the eye never
 * resolves.
 */
export const PROGRESS_INTERVAL_MS = 250

/** `lib/engines/types.ts`'s "working, but I cannot say how far along". */
const INDETERMINATE = -1

export interface ProgressRelay {
  /** Records a tick from the engine. Cheap, and safe to call in a tight loop. */
  report(progress: number): void
  /**
   * Ends the stream: stops the heartbeat and flushes a value the last window
   * had not sent yet, so the terminal `1` an engine reports just before it
   * resolves is never the one that gets swallowed.
   *
   * That flush is a `postMessage` on the callback's own port, so it can land
   * fractionally after the job's own result on the main port — a consumer must
   * treat progress as advisory once the job has settled.
   */
  stop(): void
}

/**
 * Builds a relay over `emit`.
 *
 * `emit` is called synchronously; in the worker it is the Comlink proxy for the
 * main thread's callback, and in tests it is a plain function, which is what
 * makes the timing here assertable without a thread at all.
 */
export function createProgressRelay(
  emit: ProgressCallback,
  intervalMs: number = PROGRESS_INTERVAL_MS,
): ProgressRelay {
  /**
   * The newest value there is to send.
   *
   * It starts at the indeterminate marker rather than at nothing, because the
   * relay is built before the engine is — the window it has to cover first is
   * the one where a WASM binary is downloading and the only honest answer is
   * "working, cannot say how far".
   */
  let current = INDETERMINATE
  /** Whether `current` still has to reach the other side. */
  let unsent = false
  /** Whether the engine has reported at all yet. */
  let measured = false
  let stopped = false

  const send = (value: number): void => {
    unsent = false
    emit(value)
  }

  // Started here and not on the first tick: an engine that spends ten seconds
  // loading before it can measure anything would otherwise leave the stream
  // silent for exactly as long as the user is most likely to think it hung.
  let heartbeat: ReturnType<typeof setInterval> | null = setInterval(
    () => send(current),
    intervalMs,
  )

  return {
    report(progress) {
      if (stopped) return
      current = progress

      // The first real tick goes out at once: having just told the UI it cannot
      // measure anything, waiting another quarter second to correct that is the
      // one delay a user actually notices.
      if (!measured) {
        measured = true
        send(progress)
        return
      }

      unsent = true
    },

    stop() {
      if (stopped) return
      stopped = true

      if (heartbeat !== null) {
        clearInterval(heartbeat)
        heartbeat = null
      }

      if (unsent) send(current)
    },
  }
}
