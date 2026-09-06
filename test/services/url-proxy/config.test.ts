import { describe, expect, it } from 'vitest'

import { readConfig } from '../../../services/url-proxy/src/config'

/*
 * The proxy's limits, read once from the environment (issue #87).
 *
 * Every value has a default, and the defaults are the interesting part: a
 * service that only works when six environment variables are set is a service
 * that fails closed on a deploy where one of them was forgotten. These fail
 * *safe* instead — a missing `MAX_BYTES` is the conservative ceiling, not an
 * unlimited one, and a missing origin allowlist trusts nobody rather than
 * everybody.
 */

describe('readConfig', () => {
  it('has a safe default for every value', () => {
    const config = readConfig({})

    expect(config.maxBytes).toBe(100 * 1024 * 1024)
    expect(config.timeoutMs).toBe(30_000)
    expect(config.port).toBe(8080)
    expect(config.ratePerMinute).toBe(30)
    // Nobody, rather than everybody. A proxy that answers any origin is an open
    // proxy, and an open proxy is somebody else's bandwidth bill.
    expect(config.allowedOrigins).toEqual([])
  })

  it('reads the ceiling from MAX_BYTES', () => {
    expect(readConfig({ MAX_BYTES: '1048576' }).maxBytes).toBe(1_048_576)
  })

  it('ignores a ceiling that is not a positive whole number', () => {
    for (const value of ['0', '-5', 'lots', '1.5', '', ' ']) {
      expect(readConfig({ MAX_BYTES: value }).maxBytes).toBe(100 * 1024 * 1024)
    }
  })

  it('splits ALLOWED_ORIGINS on commas and trims each one', () => {
    const config = readConfig({
      ALLOWED_ORIGINS: 'https://docify.app, https://www.docify.app ,,',
    })

    expect(config.allowedOrigins).toEqual(['https://docify.app', 'https://www.docify.app'])
  })

  it('reads the port Render assigns', () => {
    expect(readConfig({ PORT: '10000' }).port).toBe(10_000)
  })

  it('reads the upstream timeout', () => {
    expect(readConfig({ TIMEOUT_MS: '5000' }).timeoutMs).toBe(5_000)
  })

  it('reads the rate limit', () => {
    expect(readConfig({ RATE_LIMIT_PER_MINUTE: '10' }).ratePerMinute).toBe(10)
  })

  it('ignores a rate limit that is not a positive whole number', () => {
    // Zero would read as "nobody may call", which is not a value anybody sets
    // on purpose — and a limiter that refuses everything is indistinguishable
    // from an outage. Falling back to the default is the safe direction here,
    // in the other direction from MAX_BYTES, because the conservative answer to
    // a broken *ceiling* is the low one and to a broken *limit* is the working
    // one.
    for (const value of ['0', '-5', 'lots', '1.5', '', ' ']) {
      expect(readConfig({ RATE_LIMIT_PER_MINUTE: value }).ratePerMinute).toBe(30)
    }
  })
})
