# url-proxy

Streams a remote file to the browser so a conversion can start from a URL
instead of from a drop. It reads bytes and writes them straight back out — it
**stores nothing**, on disk or in memory.

The deploy is issue #100.

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
| `400`  | the `url` is missing, unparseable, or refused by the guard |
| `403`  | the `Origin` header is missing or not in `ALLOWED_ORIGINS` |
| `404`  | some other path                                            |
| `405`  | some other method                                          |
| `413`  | the upstream declared a body over `MAX_BYTES`              |
| `502`  | the upstream refused, or could not be reached              |
| `504`  | the upstream did not answer within `TIMEOUT_MS`            |

A refusal carries `x-proxy-refused` naming the check that refused it —
`scheme`, `port`, `credentials`, `hostname`, `address` or `redirect`. It is
always a fact about the caller's own URL and never about this service's
network, so echoing it tells an attacker nothing they did not already type.

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

## SSRF protection

A URL import proxy is a request-forgery primitive with a friendly name: it takes
a URL from a stranger and fetches it from inside a hosting provider's network.
Three layers stand between that and a service.

**1. The URL, before a socket is opened** (`url-guard.ts`)

- `http:` and `https:` only — `file:///etc/passwd` is the reason
- ports 80 and 443 only — `:6379` and `:11211` are Redis and memcached, which
  speak protocols forgiving enough to be driven by a shaped HTTP request
- no credentials in the authority — `https://expected.com@attacker.test/` reads
  as one host and resolves as another
- `localhost`, `*.localhost`, `*.local`, `*.internal`, `*.home.arpa` and
  `metadata.google.internal` refused by name
- literal addresses checked against the range table below

The classic shorthand bypasses — `0177.0.0.1`, `2130706433`, `0x7f.0.0.1`,
`127.1` — never reach the guard as written: the WHATWG URL parser normalises
every one of them into a dotted quad while parsing the authority, so the guard
and the socket see the same address. `test/services/url-proxy/url-guard.test.ts`
asserts that, so nobody later "hardens" this with a second parser that disagrees
with the one that actually decides where the connection goes.

**2. The address, at connection time** (`safe-lookup.ts`)

A hostname says nothing about where it resolves, and resolve-then-fetch is the
textbook victim of DNS rebinding: between the check and the connection the
attacker's DNS answers again, this time with `169.254.169.254`.

So the resolution and the decision are the same event. Node's HTTP client takes
a `lookup` function and connects to exactly the address it returns; this one
resolves with `all: true`, refuses if **any** answer is private, and hands back
the vetted addresses. There is no window between the check and the connection
because there is no second resolution.

Every answer is checked, not the first: a host that is partly inside is inside,
because the client is free to pick the private answer on a retry.

**3. Every redirect hop** (`guarded-fetch.ts`)

Three hops maximum, and each one goes through both checks again. A redirect is a
URL from a stranger exactly as much as the original was — and it is the bypass
that exists _because_ the first URL looked fine.

`redirect: 'manual'` is passed to the platform as well, so nothing can follow a
302 on this service's behalf without seeing the guard.

### Blocked ranges

| IPv4                                          | Why                                      |
| --------------------------------------------- | ---------------------------------------- |
| `0.0.0.0/8`                                   | this host — routes to localhost on Linux |
| `10.0.0.0/8`, `172.16/12`, `192.168/16`       | private                                  |
| `100.64.0.0/10`                               | carrier-grade NAT                        |
| `127.0.0.0/8`                                 | loopback — all of it, not just `.0.0.1`  |
| `169.254.0.0/16`                              | link-local, **including cloud metadata** |
| `192.0.0.0/24`, `192.88.99.0/24`              | protocol assignments, 6to4 relay         |
| `192.0.2/24`, `198.51.100/24`, `203.0.113/24` | TEST-NET-1/2/3                           |
| `198.18.0.0/15`                               | benchmarking                             |
| `224.0.0.0/4`, `240.0.0.0/4`                  | multicast, reserved, broadcast           |

| IPv6                            | Why                                                  |
| ------------------------------- | ---------------------------------------------------- |
| `::/128`, `::1/128`             | unspecified, loopback                                |
| `fc00::/7`                      | unique local                                         |
| `fe80::/10`                     | link-local                                           |
| `ff00::/8`                      | multicast                                            |
| `100::/64`, `2001:db8::/32`     | discard-only, documentation                          |
| `::ffff:0:0/96`, `64:ff9b::/96` | IPv4-mapped and NAT64 — the embedded IPv4 is checked |

Anything unparseable is blocked. An address the guard cannot read is one it
cannot vouch for, and allowing what it does not understand is the standard way
these are bypassed.

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
