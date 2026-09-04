/**
 * A fixed-window rate limiter that cannot itself be used to exhaust memory.
 *
 * `POST /api/stats` is unauthenticated, takes a tiny body and does a write —
 * which is the shape of endpoint a script is pointed at. A limiter is the
 * obvious answer, and the obvious limiter is a `Map` keyed by the caller. That
 * map is the problem: the key is derived from something the caller controls, so
 * an unbounded one turns the defence into the attack.
 *
 * Two bounds, therefore. Entries are swept from the head on every call — a
 * `Map` iterates in insertion order and a window's start is fixed, so the
 * expired entries are exactly the prefix and the sweep is amortised O(1). And a
 * hard ceiling evicts the oldest entry rather than letting the map grow past it.
 *
 * ## Why it fails open
 *
 * When the ceiling forces an eviction, the evicted caller gets a fresh
 * allowance. That is the deliberate direction: a limiter under memory pressure
 * letting a request through costs one double-counted conversion, and the other
 * way round costs a user a working conversion for a counter they never asked
 * for. Nothing this endpoint records is worth that trade.
 *
 * ## Why in-memory is enough
 *
 * Each function instance holds its own map, so the effective limit across a
 * fleet is the configured one times the number of instances. For a counter that
 * is fine — the purpose is to stop one script writing a million rows, not to
 * meter a paid API — and the alternative is a second network round trip on the
 * path of something that is meant to be free.
 *
 * The clock is injected for the reason CLAUDE.md §5.1 gives about
 * `Capabilities`: the tests are about windows, and a test about windows should
 * not have to wait for one.
 */

export interface RateLimiterOptions {
  /** How many calls one key may make inside a window. */
  limit: number
  windowMs: number
  /** How many keys to track before evicting the oldest. */
  maxKeys?: number
  now?: () => number
}

export interface RateLimiter {
  /** Whether this call is inside the key's allowance. Counts the call either way. */
  check(key: string): boolean
  /** How many keys are being tracked. For tests and for reasoning about memory. */
  size(): number
}

/** Enough for a busy instance, small enough that the map stays a rounding error. */
const DEFAULT_MAX_KEYS = 10_000

interface Window {
  start: number
  count: number
}

export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
  const { limit, windowMs, maxKeys = DEFAULT_MAX_KEYS, now = Date.now } = options
  const windows = new Map<string, Window>()

  /** Drop every window that has closed. They are the prefix, so this stops early. */
  function sweep(at: number): void {
    for (const [key, window] of windows) {
      if (at - window.start < windowMs) break
      windows.delete(key)
    }
  }

  /** Re-insert, so the map's order stays the order the windows opened in. */
  function open(key: string, at: number): void {
    windows.delete(key)
    windows.set(key, { start: at, count: 1 })

    while (windows.size > maxKeys) {
      const oldest = windows.keys().next()
      if (oldest.done === true) break
      windows.delete(oldest.value)
    }
  }

  return {
    check(key) {
      const at = now()
      sweep(at)

      const window = windows.get(key)

      if (window === undefined || at - window.start >= windowMs) {
        open(key, at)

        return true
      }

      window.count += 1

      return window.count <= limit
    },

    size() {
      return windows.size
    },
  }
}
