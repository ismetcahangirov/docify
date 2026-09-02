import type { Metadata } from 'next'
import { notFound } from 'next/navigation'

import { SectionBlock } from '@/components/blocks/section-block'
import { RelatedTools } from '@/components/blocks/related-tools'
import { ConverterIsland } from '@/components/converter/converter-island'
import { copyFor } from '@/lib/registry/copy'
import { formatMeta } from '@/lib/registry/formats'
import { PAIR_SLUGS, pairBySlug, pairTitle } from '@/lib/registry/pairs'
import { pageMetadata } from '@/lib/seo/metadata'
import { pageSchema } from '@/lib/seo/schema'
import { SITE_NAME } from '@/lib/seo/site'

/*
 * One conversion, as a page (issue #66).
 *
 * ## Everything that matters is static HTML
 *
 * The heading, the introduction, the steps, the questions, the note and the
 * links are rendered on the server at build time. They are in the document
 * before any JavaScript runs and would still be there if none of it ever did —
 * which is the whole SEO surface, and also what a reader on a slow connection
 * sees first.
 *
 * `<ConverterIsland>` is the only interactive part, and it is loaded *after*
 * that markup rather than in front of it: at 36 kB gzipped it was, on its own,
 * the difference between this route sitting inside the 120 kB first-load budget
 * and 19 kB outside it. See the header of `components/converter/converter-island`
 * for why deferring it costs the reader nothing.
 *
 * ## Why `dynamicParams` is off
 *
 * The catalogue is the complete list of pages that exist. With dynamic params
 * enabled, `/convert/anything-to-anything` would render at request time from
 * whatever was in the URL — a page for a conversion nothing can perform,
 * generated on demand, indexable, and impossible to notice. `false` makes an
 * unknown slug a 404, which is what it is.
 *
 * ## Why the structured data is written with `dangerouslySetInnerHTML`
 *
 * A `<script type="application/ld+json">` is the one place React's escaping is
 * wrong: it would encode the JSON's own quotes into HTML entities and produce a
 * block no parser can read. The content is `JSON.stringify` of an object this
 * repository builds from its own copy, so nothing user-supplied reaches it.
 */

export const dynamicParams = false

/** Every page in the catalogue, built at `next build` time. */
export function generateStaticParams(): Array<{ pair: string }> {
  return PAIR_SLUGS.map((pair) => ({ pair }))
}

interface PageProps {
  params: Promise<{ pair: string }>
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pair: slug } = await params
  const pair = pairBySlug(slug)
  const meta = pair === undefined ? undefined : pageMetadata(pair)

  if (pair === undefined || meta === undefined) return {}

  return {
    title: meta.title,
    description: meta.description,
    alternates: { canonical: meta.canonical },
    openGraph: {
      type: 'website',
      url: meta.canonical,
      siteName: SITE_NAME,
      title: meta.title,
      description: meta.description,
    },
    twitter: { card: 'summary_large_image', title: meta.title, description: meta.description },
  }
}

export default async function ConvertPairPage({ params }: PageProps) {
  const { pair: slug } = await params
  const pair = pairBySlug(slug)
  if (pair === undefined) notFound()

  const copy = copyFor(slug)
  const meta = pageMetadata(pair)
  const schema = pageSchema(pair)
  // The catalogue test proves these three exist for every pair; the check is
  // here so the page compiles without a non-null assertion rather than because
  // the case is reachable.
  if (copy === undefined || meta === undefined || schema === undefined) notFound()

  const from = formatMeta(pair.from)
  const to = formatMeta(pair.to)

  return (
    <main className="flex flex-col gap-6 py-6">
      <script
        type="application/ld+json"
        // See the module header for why this is not a child expression.
        dangerouslySetInnerHTML={{ __html: JSON.stringify(schema) }}
      />

      <SectionBlock variant="dark" aria-labelledby="convert-heading">
        {/*
         * The links are `inline-flex min-h-11` with horizontal padding, and the
         * padding is cancelled by a negative margin so the text still lines up
         * with the block's own gutter. A breadcrumb is 13px type, which renders
         * a 16px-tall hit area — the responsive contract puts the floor at
         * 44x44px, and a link nobody can tap on a phone is not a link.
         */}
        <nav aria-label="Breadcrumb" className="mb-8 font-sans text-tech text-fg-dark-mut">
          <ol className="flex list-none flex-wrap items-center gap-x-1 gap-y-0">
            <li>
              <a
                href="/"
                className="-mx-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 underline underline-offset-4"
              >
                {SITE_NAME}
              </a>
            </li>
            <li aria-hidden="true">/</li>
            <li>
              <a
                href="/convert"
                className="-mx-2 inline-flex min-h-11 min-w-11 items-center justify-center px-2 underline underline-offset-4"
              >
                Converters
              </a>
            </li>
            <li aria-hidden="true">/</li>
            <li aria-current="page" className="inline-flex min-h-11 items-center">
              {pairTitle(pair)}
            </li>
          </ol>
        </nav>

        <div className="flex min-w-0 flex-col gap-6">
          <p className="text-eyebrow uppercase text-fg-dark-mut">
            {from.name} to {to.name}
          </p>
          {/*
           * `hyphens-auto` with `break-words`: the display step is 44px at
           * 320px, and a single long word — SOUNDTRACK, TRANSPARENCY — is wider
           * than the 248px of content a 320px screen leaves after the block's
           * inset and padding. Hyphenation breaks it where English allows;
           * `break-words` is the fallback for a word the dictionary has no rule
           * for. Shrinking the type step instead would change every heading on
           * the site to fix two of them.
           */}
          <h1
            id="convert-heading"
            className="max-w-4xl text-display break-words hyphens-auto uppercase"
          >
            {copy.h1}
          </h1>
          <p className="max-w-2xl text-body text-fg-dark-mut">{copy.intro}</p>
        </div>

        <div className="mt-10">
          <ConverterIsland pair={pair} />
        </div>
      </SectionBlock>

      <SectionBlock variant="light" aria-labelledby="steps-heading">
        <h2 id="steps-heading" className="text-h2 uppercase">
          How to convert {pairTitle(pair)}
        </h2>
        <ol className="mt-8 grid list-none grid-cols-1 gap-6 md:grid-cols-3">
          {copy.steps.map((step, index) => (
            <li
              key={step}
              id={`step-${index + 1}`}
              className="flex min-w-0 flex-col gap-3 border-t border-line-light pt-4"
            >
              <span className="font-mono text-tech text-fg-light-mut">
                Step {index + 1} of {copy.steps.length}
              </span>
              <p className="text-body">{step}</p>
            </li>
          ))}
        </ol>

        <p className="mt-10 max-w-2xl border-l-2 border-line-light pl-4 text-body text-fg-light-mut">
          {copy.note}
        </p>
      </SectionBlock>

      <SectionBlock variant="light" aria-labelledby="faq-heading">
        <h2 id="faq-heading" className="text-h2 uppercase">
          Questions about {pairTitle(pair)}
        </h2>
        {/*
         * A description list, because that is what a set of questions and
         * answers is. It also gives a screen reader a structure to navigate
         * rather than an undifferentiated run of paragraphs.
         */}
        <dl className="mt-8 flex flex-col gap-8">
          {copy.faq.map((question) => (
            <div key={question.q} className="flex min-w-0 flex-col gap-2">
              <dt className="text-h3">{question.q}</dt>
              <dd className="max-w-2xl text-body text-fg-light-mut">{question.a}</dd>
            </div>
          ))}
        </dl>
      </SectionBlock>

      <SectionBlock variant="light" asChild>
        <div>
          <RelatedTools pair={pair} variant="light" />
        </div>
      </SectionBlock>
    </main>
  )
}
