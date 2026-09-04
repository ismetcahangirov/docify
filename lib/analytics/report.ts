/**
 * Tells the server that a page was opened, and nothing else about it.
 *
 * ## What goes on the wire
 *
 * One field: the path. Not the URL — the path, with any query string and any
 * fragment already gone, because `location.pathname` is what the caller passes
 * and this module never reads `location` itself. A `?utm_source=` is harmless
 * and a `?email=` is not, and the counter cannot tell them apart, so neither is
 * sent. `test/analytics/report.test.ts` decodes the beacon body and fails on a
 * second key or on anything carrying a `?` or a `#`.
 *
 * No referrer, no screen size, no language, no timezone, no user agent, and
 * nothing derived from any of them. Those are the fields that turn a page
 * counter into a fingerprint, and every one of them is absent by construction
 * rather than by configuration.
 *
 * ## Why the server counts views and not visitors
 *
 * Because telling two visitors apart requires identifying one. The usual
 * mechanism is no longer a cookie — it is a daily rotating hash of the address
 * and the user agent — and `lib/db/schema.sql` says Docify holds no IP address,
 * hashed or otherwise. So two people opening a page and one person opening it
 * twice are the same row, and there is deliberately no way to ask which
 * happened. See the schema's own comment above `page_totals`.
 *
 * ## Why it returns nothing
 *
 * The same rule as `lib/stats/report.ts`: fire-and-forget is a property of the
 * caller, enforced here by there being no promise to await. Every failure mode
 * — a blocked beacon, an extension that throws, a browser with no `sendBeacon`
 * — ends here silently. With the backend unreachable this function does nothing
 * observable at all, which is what keeps #86 true for the marketing pages too.
 */

/** Where the counter lives. Same origin, so it crosses no isolation boundary. */
const ENDPOINT = '/api/views'

/** Never throws, never returns a promise, never blocks a render. */
export function reportPageView(page: string): void {
  const body = JSON.stringify({ page })

  try {
    if (typeof navigator === 'undefined' || typeof navigator.sendBeacon !== 'function') return

    if (navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }))) return

    // The beacon existed and refused, which in practice means the browser's
    // queue is full. That is a real condition worth one retry; a browser with
    // no `sendBeacon` at all gets no request rather than a `fetch` instead.
    void fetch(ENDPOINT, {
      method: 'POST',
      keepalive: true,
      headers: { 'content-type': 'application/json' },
      body,
    }).catch(() => {
      // The visitor is reading the page. Whether the counter heard about it is
      // not their problem.
    })
  } catch {
    // A blocked beacon, a locked-down extension environment, a browser that
    // throws on a Blob body. All of them are "the count is one lower than it
    // could have been", and none is worth a line in the console.
  }
}
