// @vitest-environment node

import { describe, expect, it } from 'vitest'

import { dynamic, GET } from '@/app/llms.txt/route'
import { llmsTxt } from '@/lib/seo/llms'

/*
 * The route that serves `/llms.txt` (issue #73).
 *
 * `test/seo/llms.test.ts` asserts what the file says. This asserts that the
 * route hands it over unchanged, at the address and the content type a client
 * looking for it will accept — which is the half that breaks when the App
 * Router's conventions change under it, and the half no assertion about the
 * text would notice.
 */

describe('GET /llms.txt', () => {
  it('answers with the generated file, byte for byte', async () => {
    const response = GET()

    expect(await response.text()).toBe(llmsTxt())
  })

  it('answers 200', () => {
    expect(GET().status).toBe(200)
  })

  it('serves it as plain text, so a browser shows it rather than downloading it', () => {
    // `text/markdown` triggers a download in every browser. Every published
    // llms.txt is plain text for that reason, and the clients that read it look
    // at the body rather than at the header.
    expect(GET().headers.get('content-type')).toBe('text/plain; charset=utf-8')
  })

  it('lets a client that already has it hold on to it for a day', () => {
    expect(GET().headers.get('cache-control')).toMatch(/max-age=86400/u)
  })
})

describe('the route itself', () => {
  it('is prerendered, not a function invocation per fetch', () => {
    // The file changes when the catalogue does, which is a deploy. A handler
    // that ran per request would be compute spent regenerating a constant.
    expect(dynamic).toBe('force-static')
  })
})
