# url-proxy

Streams a remote file to the browser so a conversion can start from a URL
instead of from a drop. It reads bytes and writes them straight back out — it
**stores nothing**, on disk or in memory.

> **Not deployable yet.** The SSRF guard is issue #88 and the deploy is issue
> #100. Without #88 this service will fetch `http://169.254.169.254/` for
> anybody who asks. Do not put it on the internet before that lands.

---

## Why it exists

A browser cannot fetch an arbitrary URL — the origin on the other end decides,
through CORS, and almost none of them say yes. Importing "the file at this URL"
therefore needs exactly one server in the middle. This is the smallest one that
does the job, and it is the only server-side component Docify has besides the
anonymous counter.

It never sees a file the user chose from their own machine. Those never leave
the tab (CLAUDE.md §2.1). This is only for a URL the user typed.

## API

### `GET /fetch?url=<encoded absolute URL>`

| Status | Meaning                                                    |
| ------ | ---------------------------------------------------------- |
| `200`  | streaming the upstream body                                |
| `400`  | the `url` parameter is missing or unparseable              |
| `403`  | the `Origin` header is missing or not in `ALLOWED_ORIGINS` |
| `404`  | some other path                                            |
| `405`  | some other method                                          |
| `413`  | the upstream declared a body over `MAX_BYTES`              |
| `502`  | the upstream refused, or could not be reached              |
| `504`  | the upstream did not answer within `TIMEOUT_MS`            |

A body that turns out to be over the ceiling _while streaming_ cannot be a
`413`: the `200` was sent long before. The stream is errored and the socket
destroyed, so the transfer fails as a transfer rather than arriving truncated
and looking complete.

### `GET /healthz`

`200 ok`, with no origin check — Render polls it, and a misconfigured
`ALLOWED_ORIGINS` should not make the service look dead.

## Response headers that are not decoration

- `access-control-allow-origin` — without it the page cannot read the answer.
- `cross-origin-resource-policy: cross-origin` — without it a **cross-origin
  isolated** document cannot read the answer, and every `/convert/*` page is one
  (see the header of `next.config.ts`). Chromium blocks the response before the
  page sees a byte and the failure looks like an unexplained network error.
- `content-disposition: attachment; filename="…"` — the name comes from the
  URL's last path segment, stripped of anything that is not `A-Za-z0-9._-`.
- `x-content-type-options: nosniff` — the browser must not guess a type for
  bytes it is about to hand to a conversion engine.

## What travels upstream

Nothing of the visitor's. No cookie, no `authorization`, no `referer`, and a
`user-agent` of `Docify-URL-Import/1.0` that is identical for everybody. The
upstream learns that Docify asked; it does not learn who asked Docify.

## Configuration

| Variable          | Default     | Notes                                               |
| ----------------- | ----------- | --------------------------------------------------- |
| `PORT`            | `8080`      | Render assigns this                                 |
| `MAX_BYTES`       | `104857600` | 100 MiB                                             |
| `TIMEOUT_MS`      | `30000`     |                                                     |
| `ALLOWED_ORIGINS` | _(empty)_   | comma-separated exact origins; empty means **none** |

Every default is the conservative one. A missing `MAX_BYTES` is the ceiling, not
the absence of one, and a missing `ALLOWED_ORIGINS` trusts nobody rather than
everybody — an open proxy is somebody else's bandwidth bill.

## Running it

```bash
cd services/url-proxy
npm install
npm run build
ALLOWED_ORIGINS=http://localhost:3000 npm start
```

No runtime dependencies: `node:http` and two stream helpers. A service that will
be handed arbitrary URLs is the last place to want a supply chain.

## Tests

They live with the rest of the repository's suites, in
`test/services/url-proxy/`, and run in the `unit` CI job. `handleRequest` takes
its `fetch` as a parameter, so every assertion about upstream behaviour is made
without a network.
