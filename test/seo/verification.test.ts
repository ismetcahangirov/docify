import { describe, expect, it } from 'vitest'

import { siteVerification } from '@/lib/seo/verification'

/*
 * The Search Console verification tag (issue #103).
 *
 * ## Why the token is an environment variable and the origin is not
 *
 * `SITE_ORIGIN` is a literal on purpose: a canonical URL that varies by
 * deployment points a crawler at a preview build from production. A
 * verification token is the opposite kind of value. It is issued by a console,
 * to one property, for one person's account; it can be reissued; and it belongs
 * to whoever owns the deployment rather than to the source. So it comes from
 * the environment, and its absence is a supported state rather than a
 * misconfiguration — every preview build has no token and should render no tag.
 *
 * ## Why anything is parsed at all
 *
 * Because the console does not hand over a token. It hands over
 * `<meta name="google-site-verification" content="..." />` with a copy button,
 * and pasting that whole line into an environment variable is the mistake this
 * is written against. The failure it causes is silent in exactly the wrong way:
 * Next.js escapes the angle brackets, the page renders a `content` attribute
 * full of markup, and Google reports that verification failed without saying
 * why.
 */

describe('siteVerification', () => {
  it('renders no verification block when no token is set', () => {
    // The normal state of a preview deployment and of every local build.
    expect(siteVerification({})).toBeUndefined()
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '' })).toBeUndefined()
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '   ' })).toBeUndefined()
  })

  it('passes a bare token straight through', () => {
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: 'abc123_-XYZ' })).toEqual({
      google: 'abc123_-XYZ',
    })
  })

  it('trims a token that arrived with whitespace around it', () => {
    // A dashboard paste picks up a newline more often than not.
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '  abc123\n' })).toEqual({
      google: 'abc123',
    })
  })

  it('takes the content out of a whole meta tag that was pasted', () => {
    expect(
      siteVerification({
        GOOGLE_SITE_VERIFICATION: '<meta name="google-site-verification" content="abc123" />',
      }),
    ).toEqual({ google: 'abc123' })
  })

  it('takes the content out of a pasted tag written with single quotes', () => {
    expect(
      siteVerification({
        GOOGLE_SITE_VERIFICATION: "<meta name='google-site-verification' content='abc123'>",
      }),
    ).toEqual({ google: 'abc123' })
  })

  it('refuses a value that is not a token, rather than rendering markup', () => {
    // Anything left containing a character a token cannot contain is a paste
    // that went wrong. Rendering it would put broken markup in every one of the
    // 128 pages' <head>.
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: 'two tokens' })).toBeUndefined()
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: '<meta name="other" />' })).toBeUndefined()
    expect(siteVerification({ GOOGLE_SITE_VERIFICATION: 'abc"123' })).toBeUndefined()
  })
})

/*
 * Bing (issue #307).
 *
 * ## Why Bing is not another named field
 *
 * `Metadata['verification']` in Next.js has fields for `google`, `yandex`,
 * `yahoo` and `me`, and an `other` bag for the rest. Bing is in the bag, under
 * the name it actually renders: `msvalidate.01`. Nothing about that is a
 * workaround — it is the escape hatch working as designed, and the alternative
 * would be a hand-written `<meta>` in the layout, which is the one thing
 * `lib/seo/metadata.ts` exists to stop.
 *
 * ## Why it is here rather than imported from the Google property
 *
 * Bing Webmaster Tools can inherit a verified Search Console property in two
 * clicks, and `docs/seo/search-console.md` used to recommend exactly that. It
 * is the weaker option once the site is on a free subdomain: the verification
 * is then a link between two consoles rather than a fact stated in the
 * repository, so it cannot be reviewed, rolled back, or carried to a bought
 * domain the way a literal can.
 */

describe('siteVerification, for Bing', () => {
  it('renders no Bing entry when only Google is set', () => {
    const meta = siteVerification({ GOOGLE_SITE_VERIFICATION: 'google-token' })

    expect(meta?.google).toBe('google-token')
    expect(meta?.other).toBeUndefined()
  })

  it('renders the tag under the name Bing actually reads', () => {
    const meta = siteVerification({ BING_SITE_VERIFICATION: '54DEDFDF0D0CB5F35DBA7704B575A176' })

    expect(meta?.other).toEqual({ 'msvalidate.01': '54DEDFDF0D0CB5F35DBA7704B575A176' })
  })

  it('renders both when both are set, because a site is verified with each separately', () => {
    const meta = siteVerification({
      GOOGLE_SITE_VERIFICATION: 'google-token',
      BING_SITE_VERIFICATION: 'bing-token',
    })

    expect(meta?.google).toBe('google-token')
    expect(meta?.other).toEqual({ 'msvalidate.01': 'bing-token' })
  })

  it('renders nothing at all when neither is set', () => {
    expect(siteVerification({})).toBeUndefined()
    expect(siteVerification({ BING_SITE_VERIFICATION: '  ' })).toBeUndefined()
  })

  it('takes the content out of a whole meta tag, the way the Bing console offers it', () => {
    const meta = siteVerification({
      BING_SITE_VERIFICATION:
        '<meta name="msvalidate.01" content="54DEDFDF0D0CB5F35DBA7704B575A176" />',
    })

    expect(meta?.other).toEqual({ 'msvalidate.01': '54DEDFDF0D0CB5F35DBA7704B575A176' })
  })

  it('refuses a value that is not a token, rather than rendering markup', () => {
    expect(
      siteVerification({ BING_SITE_VERIFICATION: '<script>alert(1)</script>' }),
    ).toBeUndefined()
    expect(siteVerification({ BING_SITE_VERIFICATION: 'not a token' })).toBeUndefined()
  })
})
