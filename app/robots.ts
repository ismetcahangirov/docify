import type { MetadataRoute } from 'next'

import { SITE_ORIGIN, absoluteUrl } from '@/lib/seo/site'

/*
 * What a crawler is allowed to fetch, which here is everything.
 *
 * ## Why there is nothing to disallow
 *
 * A `robots.txt` disallow is usually protecting a search page, a user account
 * area or an admin route from being crawled. This site has none of those: there
 * is no account, no server-side processing, and every URL is a static page
 * generated from the catalogue. `/api/*` will eventually hold the anonymous
 * counters, and even that is a route no crawler would follow, since nothing
 * links to it.
 *
 * ## Why `noindex` is not expressed here
 *
 * `robots.txt` controls crawling, not indexing, and the two are routinely
 * confused. Disallowing a page stops a crawler reading it — including reading
 * the `noindex` on it, which is why a disallowed page can still appear in
 * results as a bare URL. Pages that should not be indexed say so in their own
 * metadata, where a crawler can actually see it. `/tools` is the current
 * example.
 *
 * ## Why the sitemap is named here
 *
 * It is the one line in `robots.txt` that is about discovery rather than
 * permission, and it is how a crawler that arrived from a link rather than from
 * Search Console finds the other 125 pages.
 *
 * ## Why the AI crawlers are named individually (issue #73)
 *
 * They are already allowed by the wildcard, so these lines change nothing a
 * crawler does. They are here because two of them — `Google-Extended` and
 * `Applebot-Extended` — are not crawlers at all: they are opt-out tokens whose
 * *absence* means yes. A decision that is expressed by leaving a file alone is a
 * decision nobody can review, and this one deserves reviewing: it says that a
 * model may read these pages, learn from them and answer from them.
 *
 * The answer is yes, and it is not a close call. This site has no advertising,
 * no subscription and nothing to sell; being the page an assistant quotes when
 * somebody asks how to open a HEIC on Windows is the entire distribution
 * strategy. There is also nothing here to protect — no user content, no
 * accounts, and no file that ever reached the server to be leaked.
 *
 * The list is the agents that identify themselves and honour the file. It is
 * not exhaustive and does not need to be: anything not named is covered by the
 * wildcard above, and to the same effect.
 */

/**
 * The AI agents named explicitly, and what each one is.
 *
 * Grouped by what they do rather than by vendor, because that is the axis a
 * reader is deciding on: training, answering a live question, or both.
 */
const AI_AGENTS: readonly string[] = [
  // Training corpora.
  'GPTBot',
  'ClaudeBot',
  'anthropic-ai',
  'CCBot',
  'Google-Extended',
  'Applebot-Extended',
  'meta-externalagent',
  'Amazonbot',
  'Bytespider',
  // Retrieval for a question somebody is asking right now.
  'OAI-SearchBot',
  'ChatGPT-User',
  'Claude-User',
  'Claude-SearchBot',
  'PerplexityBot',
  'Perplexity-User',
  'DuckAssistBot',
  'YouBot',
]

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      { userAgent: '*', allow: '/' },
      { userAgent: [...AI_AGENTS], allow: '/' },
    ],
    sitemap: absoluteUrl('/sitemap.xml'),
    host: SITE_ORIGIN,
  }
}
