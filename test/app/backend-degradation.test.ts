import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { readTotals, recordConversion } from '@/lib/db/stats'
import { reportConversion } from '@/lib/stats/report'

/*
 * The backend is an optional dependency (plan §0: "never on the critical
 * path"), and this file is where that sentence is checked rather than trusted —
 * issue #86.
 *
 * The individual pieces already have their own suites, and each of them
 * asserts its own half of this. What was missing is the statement of the whole
 * chain in one place: with no `DATABASE_URL` at all, every link answers "no"
 * and nothing anywhere throws. That matters because degradation is the property
 * most likely to be lost by a change that looks locally correct — a `throw` for
 * an unreachable database is a perfectly reasonable thing to write inside
 * `lib/db/`, and it would be caught here rather than on a deployment.
 *
 * The browser half — that a real conversion completes with the endpoint
 * unreachable — is `e2e/backend-degradation.spec.ts`, because it is a claim
 * about a worker, a real engine and a rendered page, and none of those exist
 * here.
 */

const NO_DATABASE = { ...process.env }

beforeEach(() => {
  vi.resetModules()
  delete process.env.DATABASE_URL
})

afterEach(() => {
  process.env = { ...NO_DATABASE }
  vi.unstubAllGlobals()
})

/** The route handlers, imported after the environment has been emptied. */
async function handlers() {
  return import('@/app/api/stats/route')
}

/** A caller nothing else in this file has used, so no limiter budget is shared. */
let callers = 0
const anonymous = () => ({ 'x-forwarded-for': `192.0.2.${(callers += 1) % 250}` })

describe('with no database configured at all', () => {
  it('connection() answers null rather than throwing', async () => {
    const { connection } = await import('@/lib/db/neon')

    expect(connection()).toBeNull()
  })

  it('the write reports failure instead of raising it', async () => {
    const { connection } = await import('@/lib/db/neon')

    await expect(
      recordConversion({ pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }, connection()),
    ).resolves.toBe(false)
  })

  it('the read answers null instead of raising', async () => {
    const { connection } = await import('@/lib/db/neon')

    await expect(readTotals(connection())).resolves.toBeNull()
  })

  it('POST /api/stats still accepts the event', async () => {
    const { POST } = await handlers()
    const response = await POST(
      new Request('https://docify.app/api/stats', {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...anonymous() },
        body: JSON.stringify({ pair: 'heic-to-jpg', outcome: 'success', bucket: 'm' }),
      }),
    )

    // 202 rather than 503. A browser cannot act on the difference, and the one
    // thing it must not do is surface it beside a conversion that worked.
    expect(response.status).toBe(202)
  })

  it('GET /api/stats answers 200 and says the figures are unavailable', async () => {
    const { GET } = await handlers()
    const response = await GET(
      new Request('https://docify.app/api/stats', { headers: anonymous() }),
    )

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ available: false })
  })
})

describe('with the endpoint unreachable from the browser', () => {
  const task = { from: 'heic', to: 'jpg' } as const

  it('a refused beacon is not an error the caller can see', () => {
    vi.stubGlobal('navigator', {
      sendBeacon: () => {
        throw new Error('net::ERR_CONNECTION_REFUSED')
      },
    })

    expect(() => reportConversion(task, 1_000, 'success')).not.toThrow()
  })

  it('a rejected fallback fetch produces no unhandled rejection', async () => {
    const rejections: unknown[] = []
    const record = (reason: unknown) => rejections.push(reason)
    process.on('unhandledRejection', record)

    vi.stubGlobal('navigator', { sendBeacon: () => false })
    vi.stubGlobal('fetch', () => Promise.reject(new Error('offline')))

    reportConversion(task, 1_000, 'success')
    // Two turns of the microtask queue, which is where an unattached `.catch`
    // would have shown up.
    await Promise.resolve()
    await new Promise((resolve) => setTimeout(resolve, 0))

    process.off('unhandledRejection', record)
    expect(rejections).toEqual([])
  })
})

describe('the client only ever sends the counter', () => {
  it('names sendBeacon in exactly one module', async () => {
    const { readdirSync, readFileSync } = await import('node:fs')
    const { dirname, join, relative, sep } = await import('node:path')
    const { fileURLToPath } = await import('node:url')

    const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

    const files = ['lib', 'components']
      .flatMap((directory) =>
        readdirSync(join(repoRoot, directory), { recursive: true, withFileTypes: true })
          .filter((entry) => entry.isFile() && /\.tsx?$/.test(entry.name))
          .map((entry) => join(entry.parentPath, entry.name)),
      )
      .filter((file) => /navigator\.sendBeacon\(|method:\s*'POST'/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(repoRoot, file).split(sep).join('/'))

    // CLAUDE.md §2.1 names `sendBeacon` as one of the APIs a file must never
    // travel on. One module sends anything at all, its payload is asserted
    // field by field in `test/stats/report.test.ts`, and a second one appearing
    // here is a review that has to happen.
    expect(files).toEqual(['lib/stats/report.ts'])
  })
})
