/**
 * The structured data a conversion page publishes about itself.
 *
 * Four types, all four on every page, and all four built from the same copy the
 * reader sees. That last part is the rule the module exists to keep: Google
 * treats structured data that is not visible on the page as spam, so every
 * question in the `FAQPage` is a question actually rendered, and every step in
 * the `HowTo` is a step actually shown. Nothing here invents a fact for a
 * crawler.
 *
 * ## Why one graph rather than four script tags
 *
 * A single `@context` with an `@graph` array lets the nodes reference each
 * other by `@id` — the breadcrumb’s last item is the page, the `HowTo` is about
 * the same application — and it emits one script tag instead of four. Both
 * shapes are valid; this one says more with less.
 *
 * ## Why the shapes are typed loosely
 *
 * `JsonLdNode` is a recursive record rather than a modelled Schema.org type.
 * Modelling even one of these properly is hundreds of lines of optional
 * properties nobody reads, and the thing that would actually catch a mistake is
 * Google's own validator, not TypeScript. `test/seo/schema.test.ts` asserts the
 * properties the Rich Results Test requires.
 */

import type { PairCopy } from '@/lib/registry/copy'
import { copyFor } from '@/lib/registry/copy'
import { formatMeta } from '@/lib/registry/formats'
import type { ConversionPair } from '@/lib/registry/pairs'
import { pairTitle } from '@/lib/registry/pairs'

import { pageMetadata } from './metadata'
import { SITE_NAME, SITE_ORIGIN, absoluteUrl } from './site'

/** A JSON-LD value: the loose shape structured data actually has. */
export type JsonLdValue = string | number | boolean | JsonLdNode | readonly JsonLdValue[]

export interface JsonLdNode {
  readonly [key: string]: JsonLdValue
}

const SCHEMA_CONTEXT = 'https://schema.org'

/** The hub every conversion page hangs off, and the breadcrumb's middle rung. */
const CONVERTERS_PATH = '/convert'

/**
 * Everything one conversion page declares, as a single JSON-LD graph — or
 * `undefined` when the pair has no copy, for the reason `pageMetadata` gives.
 */
export function pageSchema(pair: ConversionPair): JsonLdNode | undefined {
  const copy = copyFor(pair.slug)
  const meta = pageMetadata(pair)
  if (copy === undefined || meta === undefined) return undefined

  return {
    '@context': SCHEMA_CONTEXT,
    '@graph': [
      softwareApplication(pair, copy, meta.canonical, meta.description),
      howTo(pair, copy, meta.canonical),
      faqPage(copy, meta.canonical),
      breadcrumbs(pair, meta.canonical),
    ],
  }
}

/**
 * The converter itself, as a piece of software.
 *
 * `applicationCategory: 'UtilitiesApplication'` and a zero-price offer are what
 * make the free-tool result eligible; without the `offers` node the price is
 * simply unstated, which is not the same claim.
 *
 * `operatingSystem` is the honest answer rather than a list: it runs wherever
 * there is a browser, which is the product's entire proposition.
 */
export function softwareApplication(
  pair: ConversionPair,
  copy: PairCopy,
  canonical: string,
  description: string,
): JsonLdNode {
  return {
    '@type': 'SoftwareApplication',
    '@id': `${canonical}#app`,
    name: `${pairTitle(pair)} Converter`,
    url: canonical,
    description,
    applicationCategory: 'UtilitiesApplication',
    operatingSystem: 'Any device with a web browser',
    // Zero, stated. An absent offer is not a claim that something is free.
    offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
    featureList: [
      `Convert ${formatMeta(pair.from).name} to ${formatMeta(pair.to).name} in the browser`,
      'No file is ever uploaded to a server',
      'No account and no sign-up',
      'Batch conversion with a single archive download',
    ],
    // The claim the whole product is built on, in the one field a crawler
    // reads it from.
    isAccessibleForFree: true,
    publisher: { '@type': 'Organization', name: SITE_NAME, url: SITE_ORIGIN },
    // Deliberately not `aggregateRating`: there are no ratings, and inventing
    // them is the single most common way a page earns a manual penalty.
    softwareHelp: { '@type': 'CreativeWork', text: copy.note },
  }
}

/**
 * The three steps, exactly as the page lists them.
 *
 * `position` is written out rather than inferred. It is optional in the
 * vocabulary and load-bearing in practice: a consumer that ignores array order
 * would otherwise be free to render "download the result" first.
 */
export function howTo(pair: ConversionPair, copy: PairCopy, canonical: string): JsonLdNode {
  return {
    '@type': 'HowTo',
    '@id': `${canonical}#howto`,
    name: `How to convert ${pairTitle(pair)}`,
    description: copy.intro,
    // The conversion runs on the reader's own machine and costs nothing, which
    // is what these two fields say in the vocabulary's own terms.
    totalTime: 'PT1M',
    estimatedCost: { '@type': 'MonetaryAmount', currency: 'USD', value: '0' },
    supply: {
      '@type': 'HowToSupply',
      name: `A ${formatMeta(pair.from).name} file (${formatMeta(pair.from).extension})`,
    },
    tool: { '@type': 'HowToTool', name: 'A web browser' },
    step: copy.steps.map((text, index) => ({
      '@type': 'HowToStep',
      position: index + 1,
      name: firstClause(text),
      text,
      url: `${canonical}#step-${index + 1}`,
    })),
  }
}

/**
 * The questions the page answers, verbatim.
 *
 * Every one of these is rendered on the page. A `FAQPage` describing answers a
 * reader cannot see is exactly what the guidelines call out, and the penalty
 * lands on the whole set rather than the one page.
 */
export function faqPage(copy: PairCopy, canonical: string): JsonLdNode {
  return {
    '@type': 'FAQPage',
    '@id': `${canonical}#faq`,
    mainEntity: copy.faq.map((question) => ({
      '@type': 'Question',
      name: question.q,
      acceptedAnswer: { '@type': 'Answer', text: question.a },
    })),
  }
}

/**
 * Home, then the converter index, then this page.
 *
 * The last item points at the page's own canonical URL, which is what makes the
 * trail terminate rather than loop — and is why this takes the canonical rather
 * than rebuilding it.
 */
export function breadcrumbs(pair: ConversionPair, canonical: string): JsonLdNode {
  const trail = [
    { name: 'Home', item: SITE_ORIGIN },
    { name: 'Converters', item: absoluteUrl(CONVERTERS_PATH) },
    { name: pairTitle(pair), item: canonical },
  ]

  return {
    '@type': 'BreadcrumbList',
    '@id': `${canonical}#breadcrumbs`,
    itemListElement: trail.map((rung, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: rung.name,
      item: rung.item,
    })),
  }
}

/**
 * The first clause of a step, as its short name.
 *
 * A `HowToStep` wants both a `name` and a `text`, and repeating the whole
 * sentence in both reads as padding to a person and as duplication to a parser.
 * The clause before the first comma or full stop is the instruction itself —
 * "Add the HEIC files" — with the explanation left to `text`.
 */
function firstClause(step: string): string {
  const end = step.search(/[.,;—]/u)

  return (end === -1 ? step : step.slice(0, end)).trim()
}
