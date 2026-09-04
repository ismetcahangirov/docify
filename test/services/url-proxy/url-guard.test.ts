import { describe, expect, it } from 'vitest'

import { checkUrl } from '../../../services/url-proxy/src/url-guard'

/*
 * Everything that can be refused by looking at the URL alone (issue #88).
 *
 * The address check happens later, at connection time, because a hostname says
 * nothing about where it resolves. What is decidable here is the shape: the
 * scheme, the port, credentials smuggled into the authority, and the handful of
 * names that mean "inside" no matter what DNS says about them.
 */

const ok = (url: string) => checkUrl(new URL(url))

describe('checkUrl accepts', () => {
  it.each([
    ['https://example.com/photo.heic'],
    ['http://example.com/photo.heic'],
    ['https://example.com:443/photo.heic'],
    ['http://example.com:80/photo.heic'],
    ['https://sub.domain.example.com/a/b/c.pdf?v=2#x'],
  ])('%s', (url) => {
    expect(ok(url)).toEqual({ allowed: true })
  })
})

describe('checkUrl refuses a scheme that is not http or https', () => {
  it.each([
    ['file:///etc/passwd'],
    ['ftp://example.com/a'],
    ['gopher://example.com/a'],
    ['data:text/plain;base64,aGk='],
    ['blob:https://example.com/x'],
    ['jar:https://example.com/a!/b'],
  ])('%s', (url) => {
    expect(ok(url)).toEqual({ allowed: false, reason: 'scheme' })
  })
})

describe('checkUrl refuses a port that is not 80 or 443', () => {
  it.each([
    ['http://example.com:22/'],
    ['http://example.com:6379/'],
    ['http://example.com:11211/'],
    ['https://example.com:8080/'],
  ])('%s', (url) => {
    expect(ok(url)).toEqual({ allowed: false, reason: 'port' })
  })
})

describe('checkUrl refuses credentials in the authority', () => {
  it.each([
    ['https://user@example.com/'],
    ['https://user:pass@example.com/'],
    ['https://:p@e.com/'],
  ])('%s', (url) => {
    // `https://expected.com@attacker.test/` reads as `expected.com` to a
    // human and resolves as `attacker.test` to everything else.
    expect(ok(url)).toEqual({ allowed: false, reason: 'credentials' })
  })
})

describe('checkUrl refuses a name that means "inside"', () => {
  it.each([
    ['http://localhost/'],
    ['http://LOCALHOST/'],
    ['http://api.localhost/'],
    ['http://printer.local/'],
    ['http://db.internal/'],
    ['http://metadata.google.internal/'],
    ['http://router.home.arpa/'],
    ['http://[::1]/'],
    ['http://127.0.0.1/'],
    ['http://169.254.169.254/latest/meta-data/'],
    ['http://[::ffff:169.254.169.254]/'],
    ['http://0.0.0.0/'],
  ])('%s', (url) => {
    expect(ok(url).allowed).toBe(false)
  })

  it.each([
    ['http://0177.0.0.1/', '127.0.0.1', 'octal'],
    ['http://2130706433/', '127.0.0.1', 'a bare 32-bit integer'],
    ['http://0x7f.0.0.1/', '127.0.0.1', 'hexadecimal'],
    ['http://127.1/', '127.0.0.1', 'the short form'],
  ])('%s, which is %s written as %s', (url, normalised) => {
    // The classic SSRF bypass list, and none of it reaches this guard as
    // written: the WHATWG URL parser normalises every IPv4 shorthand into a
    // dotted quad while parsing the authority, so `checkUrl` and the socket
    // both see the same address. Asserted here so that the guard is not
    // "hardened" later with a parser of its own that disagrees with the one
    // that actually decides where the connection goes.
    expect(new URL(url).hostname).toBe(normalised)
    expect(ok(url)).toEqual({ allowed: false, reason: 'address' })
  })

  it('does not refuse a shorthand that means a public address', () => {
    // `010.0.0.1` is octal for 8.0.0.1, which is Level 3, not a LAN. Blocking
    // it would be a guard refusing what it does not understand rather than
    // what is dangerous.
    expect(new URL('http://010.0.0.1/').hostname).toBe('8.0.0.1')
    expect(ok('http://010.0.0.1/')).toEqual({ allowed: true })
  })

  it('says which check refused a literal address', () => {
    expect(ok('http://169.254.169.254/')).toEqual({ allowed: false, reason: 'address' })
  })

  it('says which check refused a reserved name', () => {
    expect(ok('http://db.internal/')).toEqual({ allowed: false, reason: 'hostname' })
  })
})

describe('checkUrl refuses a host that is not a host', () => {
  it('refuses an empty hostname', () => {
    expect(ok('http://[::]/').allowed).toBe(false)
  })
})
