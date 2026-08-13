/**
 * The worker's index of running jobs.
 *
 * Cancellation cannot be a parameter of `convert()`. An `AbortSignal` is not
 * structured-cloneable, and it points the wrong way anyway: by the time the user
 * hits cancel the job is already running on the other thread, so the main thread
 * needs to *reach* it, not to have handed something to it. The way across is a
 * second call — `cancel(jobId)` — and this map is what turns that id back into
 * the `AbortController` the worker kept for the job.
 *
 * Ids come from the caller. That is deliberate: the main thread has to know the
 * id before `convert()` resolves — it is cancelling a job that has not finished
 * — and a worker-minted id could only be learnt from the return value, which
 * arrives too late to be of any use.
 */

export interface JobRegistry {
  /**
   * Claims `jobId` for `controller`.
   *
   * Throws on a duplicate rather than overwriting: the previous entry is a job
   * that is still running, and dropping it would make it permanently
   * uncancellable — a silent leak of a worker-thread task, reported to nobody.
   */
  register(jobId: string, controller: AbortController): void
  /**
   * Aborts the job holding `jobId`. Returns whether there was one.
   *
   * An unknown id is an answer, not an error: a job that finished a moment
   * before the user reached the cancel button is the common case, and a
   * rejection there would turn a race into an error dialog.
   */
  abort(jobId: string): boolean
  /**
   * Drops the entry once the job has settled.
   *
   * `controller` identifies the caller, so a late release from a finished job
   * cannot evict the job that has since taken the same id.
   */
  release(jobId: string, controller: AbortController): void
  /** How many jobs are currently registered. */
  readonly size: number
}

export function createJobRegistry(): JobRegistry {
  const running = new Map<string, AbortController>()

  return {
    register(jobId, controller) {
      if (running.has(jobId)) {
        throw new Error(
          `A conversion with id "${jobId}" is already running. ` +
            'Job ids must be unique for as long as the job they name is in flight.',
        )
      }

      running.set(jobId, controller)
    },

    abort(jobId) {
      const controller = running.get(jobId)
      if (controller === undefined) return false

      // The entry stays: the job is still unwinding its engine and will release
      // the id itself. Evicting here would let a second job claim the id while
      // the first still owns the thread.
      controller.abort()
      return true
    },

    release(jobId, controller) {
      if (running.get(jobId) === controller) running.delete(jobId)
    },

    get size() {
      return running.size
    },
  }
}
