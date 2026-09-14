/**
 * Importing a file the visitor named by URL (issue #270).
 *
 * ## This does not break the promise the product is built on
 *
 * CLAUDE.md §2.1 — no file content ever reaches a server — is about *the
 * visitor's own files*, and nothing here reads one. The only thing that leaves
 * the tab is a URL that was typed into a box, and it leaves because a browser
 * cannot fetch an arbitrary URL by itself: almost no origin opts into being
 * read cross-origin, so "paste a link" needs exactly one server in the middle.
 * `services/url-proxy` is that server, it streams and stores nothing, and the
 * bytes it returns are converted in this tab like every dropped file.
 *
 * The distinction is worth keeping sharp, because it is the one a reader will
 * check: a dropped file never touches a network, and an imported one was
 * already on somebody's network before Docify heard of it.
 *
 * ## Why the failures are spelled out here
 *
 * The proxy answers a refusal with a status and, for anything it decided about
 * the URL itself, an `x-proxy-refused` header naming the check. A browser turns
 * all of that into "Failed to fetch" if nobody translates it, and CLAUDE.md
 * §2.5's rule — a rejection explains itself — is not worth less because this
 * one comes over HTTP rather than out of the router.
 *
 * ## Why the endpoint is read inside the function
 *
 * `process.env.NEXT_PUBLIC_PROXY_URL` is replaced with a literal at build time
 * wherever the whole expression appears, so reading it here costs nothing and
 * keeps {@link isUrlImportConfigured} honest in a test that changes it.
 *
 * An unset variable is the normal state, not an error: the proxy is deployed
 * separately and deliberately (docs/backend/render-deploy.md), and a Docify
 * running without one simply does not offer the control.
 */

import { isAbort } from '@/lib/abort'

/** What a caller is told when there is no proxy to ask. */
export const PROXY_UNCONFIGURED = 'URL import is not configured.'

/** The fetch this module uses. A parameter so the tests need no network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>

export interface ImportOptions {
  fetch?: FetchLike
  signal?: AbortSignal
}

/** The proxy endpoint, or `null` when none is deployed. */
function endpoint(): string | null {
  const configured = process.env.NEXT_PUBLIC_PROXY_URL?.trim()

  return configured !== undefined && configured.length > 0 ? configured.replace(/\/+$/, '') : null
}

/** Whether this deployment can import from a URL at all. The control is hidden when it cannot. */
export function isUrlImportConfigured(): boolean {
  return endpoint() !== null
}

/**
 * Wakes the proxy, because a free Render instance sleeps and a boot is a minute
 * (issue #319).
 *
 * ## Why this is not a keep-alive
 *
 * Render's free plan allows 750 instance hours a month across the whole
 * workspace, and a 31-day month run continuously is 744 of them. A cron holding
 * the instance awake would spend the entire budget so that a control almost
 * nobody uses is faster, and would leave no room for a second free service
 * ever. This spends nothing at all until somebody reaches for the field.
 *
 * ## What it actually buys
 *
 * Not the minute. A boot is about that, and pasting a URL and pressing Fetch is
 * a few seconds, so the honest claim is that those seconds now overlap the boot
 * instead of following it. That is the whole of it, and it is worth having
 * because it is free.
 *
 * ## Why `no-cors`, and why nothing reads the answer
 *
 * `/healthz` is answered in `services/url-proxy/src/proxy.ts` before the origin
 * allowlist and before the rate limiter — which is what makes it the right path
 * to knock on: a warm-up needs no origin to be allowed and spends none of
 * `RATE_LIMIT_PER_MINUTE`. The cost of being answered that early is that it
 * carries no CORS headers, so the response is opaque here. That is not a
 * limitation to work around: the request arriving is the entire point, and the
 * body says `ok` whatever happens.
 *
 * ## Why it returns nothing
 *
 * There is no outcome a caller could act on. A warm-up that fails leaves the
 * import exactly where it would have been without one, and an unhandled
 * rejection would be the only thing a visitor ever learned about a feature they
 * have not used yet. It is swallowed deliberately.
 */
export function warmUrlImport(options: { fetch?: FetchLike } = {}): void {
  const proxy = endpoint()
  if (proxy === null) return

  const call = options.fetch ?? globalThis.fetch.bind(globalThis)

  void call(`${proxy}/healthz`, {
    mode: 'no-cors',
    credentials: 'omit',
    // A cached 'ok' would wake nothing, which is the only thing this is for.
    cache: 'no-store',
  }).catch(() => {})
}

/**
 * The name to give the imported bytes.
 *
 * The proxy already strips separators and quotes out of what it sends, so this
 * is the second of two guards rather than the only one — and it is here because
 * the name reaches a `File`, which is what the whole queue displays and what a
 * download is eventually named after.
 */
function filenameFrom(disposition: string | null): string {
  const quoted = disposition?.match(/filename\*?=(?:UTF-8'')?"?([^";]+)"?/i)?.[1]
  const trimmed = quoted?.trim()
  if (trimmed === undefined || trimmed.length === 0) return 'download'

  // Only the last segment, so a name that arrived as a path becomes a name.
  const last = trimmed.split(/[\\/]/).filter(Boolean).pop() ?? ''
  const safe = last.replace(/[^A-Za-z0-9._-]/g, '').replace(/^\.+/, '')

  return safe.length > 0 ? safe.slice(0, 120) : 'download'
}

/**
 * What to tell the visitor about a refusal.
 *
 * Every branch names something they can act on. "Something went wrong" is
 * forbidden by CLAUDE.md §2.5 and would be useless here anyway: the four
 * interesting statuses are four different problems with four different answers.
 */
function refusalMessage(response: Response): string {
  const refused = response.headers.get('x-proxy-refused')
  if (refused !== null && refused.length > 0) {
    return `This URL cannot be fetched: ${refused}. Try a direct link to the file itself.`
  }

  switch (response.status) {
    case 413:
      return 'That file is larger than the 100 MB import limit. Download it and drop it in instead.'
    case 429:
      return 'Too many imports from this network. Try again in a minute, or drop the file in instead.'
    case 504:
      return 'The site holding that file did not answer in time. It may be slow or offline.'
    case 502:
      return 'The site holding that file could not be reached, or refused to hand it over.'
    default:
      return `That link could not be fetched (${response.status}). Check it opens in a new tab.`
  }
}

/**
 * The URL, if it is one this proxy could even be asked about.
 *
 * Checked here as well as in the service because a free Render instance that
 * has gone to sleep costs about a minute to wake, and a `file://` URL should
 * not cost anybody that to be told no. The service's `url-guard.ts` remains the
 * decision that matters — this is the cheap half of the same answer.
 */
function parse(raw: string): URL {
  let target: URL
  try {
    target = new URL(raw.trim())
  } catch {
    throw new Error('That is not a valid URL. It needs to start with https://.')
  }

  if (target.protocol !== 'https:' && target.protocol !== 'http:') {
    throw new Error('Only http and https links can be imported.')
  }

  return target
}

/**
 * Fetches the file at `url` through the proxy and hands back a `File` the queue
 * can take exactly as if it had been dropped.
 */
export async function importFromUrl(url: string, options: ImportOptions = {}): Promise<File> {
  const proxy = endpoint()
  if (proxy === null) throw new Error(PROXY_UNCONFIGURED)

  const target = parse(url)
  const call = options.fetch ?? globalThis.fetch.bind(globalThis)

  let response: Response
  try {
    response = await call(`${proxy}/fetch?url=${encodeURIComponent(target.toString())}`, {
      signal: options.signal,
      // Nothing of this visitor's travels with it, and the proxy would refuse
      // it anyway: its allowlist is an origin, not a session.
      credentials: 'omit',
      mode: 'cors',
    })
  } catch (reason) {
    // A cancellation is the caller's own doing and belongs to them unchanged.
    // `isAbort` rather than a name comparison written out here: `lib/abort.ts`
    // is deliberately the only module in `lib/` that spells the name, and a
    // test holds that line.
    if (isAbort(reason)) throw reason

    throw new Error('The import service could not be reached. It may be waking up — try again.')
  }

  if (!response.ok) throw new Error(refusalMessage(response))

  // `arrayBuffer` rather than `blob`: `new File([blob], …)` is not portable —
  // jsdom stringifies a `Blob` handed to the `File` constructor on some Node
  // versions and reads its bytes on others, so the same test passed on the dev
  // machine and produced a file containing "[object Blob]" in CI.
  //
  // Guarded, because this is where the import limit that actually holds lands.
  // `limit-stream.ts` calls the `content-length` check "the polite half": most
  // upstreams answer chunked, so the 413 above never fires and the proxy errors
  // the body instead — after `200` and its headers have gone out, which is HTTP
  // rather than a shortcut. Left bare, the platform's own `TypeError` escapes
  // and the visitor reads "Failed to fetch", which names nothing they can do
  // (CLAUDE.md §2.5). A dropped connection arrives here in the same shape and
  // wants the same sentence.
  let bytes: ArrayBuffer
  try {
    bytes = await response.arrayBuffer()
  } catch (reason) {
    if (isAbort(reason)) throw reason

    throw new Error(
      'The download stopped before the whole file arrived. It may be past the 100 MB import ' +
        'limit, or the site holding it cut the connection — download it and drop it in instead.',
    )
  }

  return new File([bytes], filenameFrom(response.headers.get('content-disposition')), {
    // The header, not `blob.type`. The proxy always sends one — falling back to
    // `application/octet-stream` when the upstream declared none — and reading
    // it here keeps the type the proxy decided rather than one inferred twice.
    type: response.headers.get('content-type') ?? 'application/octet-stream',
  })
}
