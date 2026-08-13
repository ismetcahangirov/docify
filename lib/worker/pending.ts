/**
 * The main thread's record of the jobs it is still waiting on.
 *
 * It exists to close one hole. Terminating a worker is instantaneous and
 * unilateral: the thread is gone, and with it every Comlink request promise
 * that was waiting for an answer. Comlink has no notion of "the endpoint died",
 * so those promises are never settled — not resolved, not rejected — and a
 * caller's `await` waits for the rest of the session. The spinner never stops,
 * the `finally` that would have revoked an object URL never runs, and the
 * `Blob`s captured by the pending continuation stay reachable.
 *
 * So the promise the caller actually holds is one this module can reach, and
 * `terminateWorker()` rejects the lot before the thread goes away.
 *
 * Its own module, and not part of `client.ts`, because `client.ts` and
 * `jobs.ts` both need it and would otherwise import each other.
 */

type Reject = (reason: unknown) => void

const pending = new Map<string, Reject>()

/**
 * Records that `jobId` is in flight.
 *
 * Throws on a duplicate: the entry already there belongs to a job that has not
 * settled, and overwriting it would make that job the very thing this module
 * exists to prevent — a promise nothing can ever settle.
 */
export function trackPendingJob(jobId: string, reject: Reject): void {
  if (pending.has(jobId)) {
    throw new Error(
      `A conversion with id "${jobId}" is already in flight. ` +
        'Job ids must be unique for as long as the job they name is running.',
    )
  }

  pending.set(jobId, reject)
}

/**
 * Forgets a job that has settled.
 *
 * Not merely tidiness: an entry left behind holds the caller's continuation
 * alive and blocks the id from ever being used again.
 */
export function releasePendingJob(jobId: string): void {
  pending.delete(jobId)
}

/**
 * Rejects every job still in flight and empties the record.
 *
 * Called when the worker goes away — deliberately or by crashing. Rejecting a
 * promise that has already settled is a no-op, so a job that finished in the
 * same tick keeps its result.
 *
 * What this cannot recover is the `MessagePort` pair behind each job's progress
 * callback: the worker releases those when a job settles, and a worker that has
 * been terminated will never settle anything. Comlink keeps the main thread's
 * end inside its transfer handler and offers no handle to close it, so the
 * ports of the jobs alive at termination are lost. Bounded by how many were
 * running, and the alternative — not killing a wedged worker — is worse.
 */
export function rejectPendingJobs(reason: unknown): void {
  const reasons = [...pending.values()]
  pending.clear()
  for (const reject of reasons) reject(reason)
}
