/**
 * A fixed-window rate limiter that cannot itself be used to exhaust memory.
 *
 * This is `lib/api/rate-limit.ts`, copied rather than imported (issue #269).
 * The service is deployed on its own from `services/url-proxy` as its `rootDir`
 * — Render never sees the rest of the repository — so an import across that
 * boundary would build here and fail there. Copying eighty dependency-free
 * lines is the honest cost of a service that ships alone, and it is the same
 * trade the service already makes by writing its own `node:http` client rather
 * than taking undici.
 *
 * The two bounds are the point. The key is derived from something the caller
 * influences, so an unbounded map turns the defence into the attack: entries
 * are swept from the head on every call — a `Map` iterates in insertion order
 * and a window's start is fixed, so the expired entries are exactly the prefix
 * — and a hard ceiling evicts the oldest rather than growing past it.
 *
 * ## Why it fails open
 *
 * When the ceiling forces an eviction the evicted caller gets a fresh
 * allowance. Under memory pressure, letting a transfer through costs bandwidth;
 * the other way round costs somebody a working import. For a free feature that
 * is the right direction.
 *
 * ## Why in-memory is enough
 *
 * One instance, holding nothing, restarted whenever Render feels like it. A
 * shared store would be a second network round trip and a second thing to
 * operate, in front of a service whose whole design is that it owns no state.
 * The limit is per instance, and there is one instance.
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
