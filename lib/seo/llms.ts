/**
 * `/llms.txt` — the site, written for something that reads rather than crawls.
 *
 * ## What it is for
 *
 * An assistant answering "how do I open a HEIC on Windows" does not crawl. It
 * fetches a handful of pages inside a context window and answers from them, and
 * what it can fetch is decided by what it can find. A sitemap is 126 URLs with
 * no words attached; this is the same list with a sentence against each, in the
 * order a person would want them, small enough to be read whole.
 *
 * The format is the llms.txt convention: an H1 with the site's name, a
 * blockquote summarising it, prose that may be skipped, and `##` sections of
 * links written as `- [name](url): description`. Nothing here is invented for
 * the file — the descriptions are each page's own `h1`, which is hand-written
 * and distinct per pair, so this cannot drift from what the pages say.
 *
 * ## Why it is generated and not written
 *
 * The same reason the sitemap is. A hand-kept list of 124 URLs is a list that is
 * correct on the day it is written; `test/seo/llms.test.ts` asserts this one
 * names every page in the catalogue and links each to the URL that page claims
 * as canonical.
 *
 * ## What it is not
 *
 * Not an indexing signal. Google has said it does not read llms.txt, and no
 * ranking claim is made for it here. It costs one static file and it is the one
 * thing on the site that answers "what is here" in a form an assistant can use.
 */

import { formatMeta, type FormatKind } from '@/lib/registry/formats'
import { copyFor } from '@/lib/registry/copy'
import { PAIRS, type ConversionPair } from '@/lib/registry/pairs'
import { pageMetadata } from '@/lib/seo/metadata'

import { absoluteUrl, SITE_DESCRIPTION, SITE_NAME } from './site'

/** The order the sections appear in, and what each is called. */
const SECTIONS: ReadonlyArray<{ kind: FormatKind; heading: string }> = [
  { kind: 'image', heading: 'Image conversions' },
  { kind: 'document', heading: 'Document conversions' },
  { kind: 'video', heading: 'Video conversions' },
  { kind: 'audio', heading: 'Audio conversions' },
  { kind: 'archive', heading: 'Archive conversions' },
]

/**
 * The paragraphs under the summary.
 *
 * Three facts, and they are the three an assistant gets wrong about a converter
 * if nobody tells it: where the file goes, what it costs, and what the limit is.
 * Written as prose rather than as a list because this section is the one part of
 * the file a reader is expected to read rather than to index.
 */
const PREAMBLE = [
  'Every conversion runs inside the visitor’s own browser, in a Web Worker, using ' +
    'WebAssembly and the browser’s own codecs. No file is uploaded, and the server ' +
    'never receives file contents — there is no server-side processing at all.',
  'There is no account, no sign-up, no email and no watermark. Nothing is behind a ' +
    'paywall and there is no per-file or per-day quota; the only ceiling is the ' +
    'device’s own memory, which the app measures before it accepts a job and ' +
    'explains when it cannot.',
  'Each page below covers one conversion, and each answers the questions people ' +
    'actually ask about that pair — why the format is a problem, what is lost, and ' +
    'what the result will look like.',
]

/**
 * One `- [name](url): description` line, or nothing when the pair has no copy.
 *
 * The description is the page's own `h1`. Writing a second sentence here would
 * be a second thing to keep true.
 */
function line(pair: ConversionPair): string[] {
  const meta = pageMetadata(pair)
  const copy = copyFor(pair.slug)
  if (meta === undefined || copy === undefined) return []

  const from = formatMeta(pair.from).name
  const to = formatMeta(pair.to).name

  return [`- [${from} to ${to}](${meta.canonical}): ${copy.h1}`]
}

/** The whole file, as the text the route serves. */
export function llmsTxt(): string {
  const blocks: string[] = [
    `# ${SITE_NAME}`,
    `> ${SITE_DESCRIPTION}`,
    ...PREAMBLE,
    '## Start here',
    [
      `- [${SITE_NAME}](${absoluteUrl('/')}): what the tool is and what it will not do with a file.`,
      `- [All converters](${absoluteUrl('/convert')}): every conversion this site has a page for.`,
    ].join('\n'),
  ]

  for (const { kind, heading } of SECTIONS) {
    const lines = PAIRS.filter((pair) => formatMeta(pair.from).kind === kind).flatMap(line)
    // A section with nothing in it is a heading that promises a list and then
    // does not have one; formats gain pages over time and this file should say
    // so only once they do.
    if (lines.length === 0) continue

    blocks.push(`## ${heading}`, lines.join('\n'))
  }

  // One trailing newline: this is a text file, and a text file ends with one.
  return `${blocks.join('\n\n')}\n`
}
