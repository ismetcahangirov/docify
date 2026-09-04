import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'

import { readConfig } from './config.js'
import { handleRequest } from './proxy.js'

/**
 * The Node adapter, and the only file here that touches a socket.
 *
 * Everything above it — `proxy.ts`, `limit-stream.ts`, `config.ts` — speaks
 * `Request` and `Response`, which is what makes the whole service testable in
 * the repository's own Vitest suites without a server, a port or a network.
 * This file exists to turn one into the other, and to do nothing else.
 *
 * ## No dependencies
 *
 * `node:http` and two stream helpers. A proxy that reads bytes and writes them
 * back does not need a framework, and a service with no dependencies has no
 * supply chain, no lockfile drift and no `pnpm audit` finding of its own. It is
 * also the smallest thing to reason about for something that will be handed
 * arbitrary URLs.
 *
 * ## Deployment
 *
 * Render, per the plan's task 10.5, and the actual deploy is issue #100. The
 * service must not go up before #88 lands: without the SSRF guard it will
 * happily fetch `http://169.254.169.254/` for anyone who asks.
 */

/** The Web `Request` that a Node request describes. */
function toWebRequest(incoming: IncomingMessage, origin: string): Request {
  const headers = new Headers()

  for (const [name, value] of Object.entries(incoming.headers)) {
    if (value === undefined) continue
    for (const one of Array.isArray(value) ? value : [value]) headers.append(name, one)
  }

  return new Request(new URL(incoming.url ?? '/', origin), {
    method: incoming.method ?? 'GET',
    headers,
    // GET and OPTIONS are the only methods `handleRequest` serves, and neither
    // has a body. Anything else is answered 405 without one being read.
  })
}

/** Writes a Web `Response` out to a Node one, streaming the body. */
async function send(response: Response, outgoing: ServerResponse): Promise<void> {
  outgoing.writeHead(response.status, Object.fromEntries(response.headers))

  if (response.body === null) {
    outgoing.end()

    return
  }

  try {
    // `Readable.fromWeb` wants `node:stream/web`'s ReadableStream and a
    // `Response` carries the DOM one. They are the same object at runtime — the
    // two declarations differ only in whether the async iterator is on them —
    // and the repository's tsconfig has both libs loaded, which is what makes
    // the difference visible here and nowhere else.
    await pipeline(Readable.fromWeb(response.body as unknown as NodeReadableStream), outgoing)
  } catch {
    // The stream errored — almost always `limitStream` refusing a body that
    // turned out to be over the ceiling, sometimes the client going away. The
    // status line left hours ago, so destroying the socket is the only way left
    // to say the transfer did not complete. A truncated body that looked
    // complete would be worse.
    outgoing.destroy()
  }
}

export function start(
  env: Record<string, string | undefined> = process.env,
): ReturnType<typeof createServer> {
  const config = readConfig(env)

  const server = createServer((incoming, outgoing) => {
    const origin = `http://${incoming.headers.host ?? 'localhost'}`

    void handleRequest(toWebRequest(incoming, origin), config, fetch)
      .then((response) => send(response, outgoing))
      .catch(() => {
        // Nothing above should throw; if it does, the client gets a status
        // rather than a hung socket.
        if (!outgoing.headersSent) outgoing.writeHead(500)
        outgoing.end()
      })
  })

  server.listen(config.port)

  return server
}

// `import.meta.url` matches only when this file was the entry point, so
// importing it from a test does not start a server on a real port.
if (
  process.argv[1] !== undefined &&
  import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/'))
) {
  start()
}
