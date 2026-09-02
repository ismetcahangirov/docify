import type { Metadata } from 'next'

import { SectionBlock } from '@/components/blocks/section-block'
import { ALL_FORMATS, formatMeta } from '@/lib/registry/formats'
import { PAIRS, pairTitle, pairsFrom } from '@/lib/registry/pairs'
import { convertHref } from '@/lib/registry/slugs'
import { absoluteUrl, SITE_NAME } from '@/lib/seo/site'

/*
 * The hub every conversion page hangs off (issue #66).
 *
 * This replaces the placeholder that existed only so the cross-origin isolation
 * headers on `/convert/:path*` could be exercised before there were any real
 * pages. It is a real page now: the complete catalogue, grouped by the format
 * somebody arrives holding.
 *
 * ## Why the hub matters more than it looks
 *
 * Every conversion page links back here and this page links to all of them, so
 * it is the one node that makes the set a connected graph rather than a hundred
 * and twenty-four islands. It is also the middle rung of every page's
 * breadcrumb, which is why it must be indexable — a breadcrumb through a
 * `noindex` page is a trail that goes nowhere.
 *
 * ## Plain anchors, again
 *
 * `/convert/*` is cross-origin isolated and a `next/link` soft navigation
 * carries the previous document's isolation across the boundary. A whole-document
 * load is what guarantees a converter page gets its own headers, and this page
 * is where most people will enter one from.
 */

const TITLE = `All ${PAIRS.length} File Converters — Free, In Your Browser | ${SITE_NAME}`

const DESCRIPTION = `Every conversion ${SITE_NAME} performs, grouped by the format you already have. All ${PAIRS.length} run in your browser. Free, and nothing is uploaded.`

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: absoluteUrl('/convert') },
  openGraph: {
    type: 'website',
    url: absoluteUrl('/convert'),
    siteName: SITE_NAME,
    title: TITLE,
    description: DESCRIPTION,
  },
}

/** The source formats that have at least one page, in catalogue order. */
const sources = ALL_FORMATS.filter((format) => pairsFrom(format.id).length > 0)

export default function ConvertIndexPage() {
  return (
    <main className="flex flex-col gap-6 py-6">
      <SectionBlock variant="dark" aria-labelledby="hub-heading">
        <div className="flex min-w-0 flex-col gap-6">
          <p className="text-eyebrow uppercase text-fg-dark-mut">Converters</p>
          <h1
            id="hub-heading"
            className="max-w-4xl text-display break-words hyphens-auto uppercase"
          >
            Every converter, and not one of them uploads your file
          </h1>
          <p className="max-w-2xl text-body text-fg-dark-mut">
            {PAIRS.length} conversions across images, documents, video and audio. Each one runs on
            your own device, in this tab, with no account and no queue to wait in. Start from the
            format you already have.
          </p>
        </div>
      </SectionBlock>

      {sources.map((source) => (
        <SectionBlock
          key={source.id}
          variant="light"
          aria-labelledby={`from-${source.id}`}
          className="flex min-w-0 flex-col gap-6"
        >
          <div className="flex min-w-0 flex-col gap-2">
            <h2 id={`from-${source.id}`} className="text-h2 uppercase">
              From {source.name}
            </h2>
            <p className="max-w-2xl text-body text-fg-light-mut">{source.summary}</p>
          </div>

          <ul className="grid list-none grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {pairsFrom(source.id).map((pair) => (
              <li key={pair.slug} className="min-w-0">
                <a
                  href={convertHref(pair.from, pair.to)}
                  className={[
                    'flex min-w-0 flex-col gap-1 rounded-md border border-line-light bg-paper p-4',
                    'text-body break-words transition-colors hover:bg-paper-2',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-current',
                  ].join(' ')}
                >
                  <span className="text-h3">{pairTitle(pair)}</span>
                  <span className="font-mono text-tech text-fg-light-mut">
                    {source.extension} to {formatMeta(pair.to).extension}
                  </span>
                </a>
              </li>
            ))}
          </ul>
        </SectionBlock>
      ))}
    </main>
  )
}
