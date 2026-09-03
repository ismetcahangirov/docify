import { llmsTxt } from '@/lib/seo/llms'

/*
 * `/llms.txt` (issue #73).
 *
 * ## Why a route handler and not a file in public/
 *
 * A file in `public/` would be a second copy of the catalogue, correct on the
 * day it was written. This is generated from the same `PAIRS` the pages and the
 * sitemap are, so a pair added tomorrow appears here without anybody
 * remembering — which is the same argument `app/sitemap.ts` makes, and the
 * reason that is a route too.
 *
 * The directory really is called `llms.txt`. The App Router treats a segment
 * literally, so `app/llms.txt/route.ts` serves `/llms.txt` — no rewrite, no
 * `next.config.ts` entry.
 *
 * ## Why it is static
 *
 * `force-static` prerenders it during `next build`, next to the 124 pages it
 * lists. There is nothing per-request about it, and a handler that runs on
 * every fetch would be a function invocation for a file that changes when the
 * catalogue does.
 *
 * ## Why the content type is text/plain
 *
 * The file is Markdown, and `text/markdown` would make a browser download it
 * rather than show it. Every published llms.txt is served as plain text for
 * that reason, and the clients that read it look at the body, not the header.
 */

export const dynamic = 'force-static'

export function GET(): Response {
  return new Response(llmsTxt(), {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      // A day. The file changes when the catalogue does, which is a deploy, and
      // a deploy replaces it anyway — this is only about how often a client that
      // already has it asks again.
      'Cache-Control': 'public, max-age=86400, must-revalidate',
    },
  })
}
