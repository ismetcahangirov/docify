/**
 * Everything the proxy is allowed to do, read once from the environment.
 *
 * Every value has a default, and every default is the conservative one. A
 * service that only works when six variables are set is a service that breaks
 * on the deploy where one of them was forgotten — and the way this one would
 * break matters: a missing `MAX_BYTES` must not mean "no ceiling", and a
 * missing `ALLOWED_ORIGINS` must not mean "answer everybody". An open proxy is
 * somebody else's bandwidth bill and somebody else's abuse report.
 *
 * So a value that is absent, empty or nonsense falls back to the safe answer
 * rather than to the permissive one, and `ALLOWED_ORIGINS` unset means nobody.
 */

export interface ProxyConfig {
  /** The hard ceiling on a proxied body, in bytes. */
  maxBytes: number
  /** How long an upstream has to answer before the request is abandoned. */
  timeoutMs: number
  port: number
  /** Exact origins the browser may call from. Empty means none. */
  allowedOrigins: readonly string[]
}

const DEFAULTS = {
  maxBytes: 100 * 1024 * 1024,
  timeoutMs: 30_000,
  port: 8080,
} as const

/** A positive whole number, or `null` for anything else. */
function positiveInteger(value: string | undefined): number | null {
  if (value === undefined) return null

  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null

  const parsed = Number(trimmed)

  return parsed > 0 ? parsed : null
}

export function readConfig(env: Record<string, string | undefined>): ProxyConfig {
  return {
    maxBytes: positiveInteger(env.MAX_BYTES) ?? DEFAULTS.maxBytes,
    timeoutMs: positiveInteger(env.TIMEOUT_MS) ?? DEFAULTS.timeoutMs,
    // Render assigns the port; the default is only for a local run.
    port: positiveInteger(env.PORT) ?? DEFAULTS.port,
    allowedOrigins: (env.ALLOWED_ORIGINS ?? '')
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  }
}
