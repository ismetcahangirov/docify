#!/usr/bin/env node
/**
 * The pre-launch SEO audit — `pnpm audit:seo`, after `pnpm build`.
 *
 * Reads every HTML file `next build` wrote, runs `./rules.mjs` over each of
 * them, and exits non-zero on any critical finding. It is the only check in
 * this repository that looks at what a crawler would actually receive; every
 * other SEO guard asserts about the generator that produced it.
 *
 * Requires a production build to be present, and says so rather than passing
 * quietly when there is not one — a gate that audits nothing reports success
 * for ever.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, posix, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

import { auditLinks, auditPage, auditUniqueness } from './rules.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const appDir = join(repoRoot, '.next', 'server', 'app')

/**
 * The origin every canonical URL on this site is built from.
 *
 * Read out of `lib/seo/site.ts` rather than repeated, so a change there fails
 * the audit rather than being silently agreed with.
 */
const ORIGIN = (() => {
  const source = readFileSync(join(repoRoot, 'lib', 'seo', 'site.ts'), 'utf8')
  const match = /SITE_ORIGIN\s*=\s*'([^']+)'/.exec(source)
  if (match?.[1] === undefined) throw new Error('lib/seo/site.ts declares no SITE_ORIGIN')

  return match[1]
})()

/**
 * Pages the audit knows are not meant to be indexed.
 *
 * `/tools` is still the placeholder that carries `robots: { index: false }`,
 * and `/_not-found` is the 404 shell, which is not a page at all. Naming them
 * means the rule can assert the *positive* — that everything else is
 * indexable — rather than only complaining about noindex where it finds it.
 */
const NOT_INDEXABLE = new Set(['/tools', '/_not-found'])

/** Pages that carry no structured data, because they are not about a conversion. */
const NO_STRUCTURED_DATA = new Set(['/', '/convert', '/tools', '/_not-found'])

/** @param {string} message */
function fail(message) {
  if (process.env.GITHUB_ACTIONS === 'true') console.log(`::error::${message}`)
  console.error(`\n${message}`)
  process.exitCode = 1
}

/**
 * `.next/server/app/convert/heic-to-jpg.html` -> `/convert/heic-to-jpg`, and
 * `.next/server/app/llms.txt.body` -> `/llms.txt`.
 */
function urlOf(file) {
  const path = posix.join(...relative(appDir, file).split(sep)).replace(/\.(?:html|body)$/, '')

  return path === 'index' ? '/' : `/${path}`
}

/**
 * Every file the build wrote for a URL, under `.next/server/app`.
 *
 * Two kinds. A prerendered page is an `.html` file, and those are what the
 * audit reads. A static route handler — `/llms.txt`, `/robots.txt`,
 * `/sitemap.xml` — is written as a `.body` beside a `.meta`, and while there is
 * no HTML to audit in one, it is a URL the build produced: a link to it is not
 * broken. The site footer links to `/llms.txt` from every page (#267), and
 * without this the audit reported a hundred and twenty-seven broken links to
 * a file that was right there.
 */
function producedFiles(directory = appDir) {
  return readdirSync(directory).flatMap((name) => {
    const path = join(directory, name)
    if (statSync(path).isDirectory()) return producedFiles(path)

    return name.endsWith('.html') || name.endsWith('.body') ? [path] : []
  })
}

function main() {
  let files
  let produced
  try {
    produced = producedFiles()
    files = produced.filter((file) => file.endsWith('.html'))
  } catch (error) {
    fail(
      `Could not read the build output: ${error instanceof Error ? error.message : String(error)}. ` +
        'Run `pnpm build` first.',
    )
    return
  }

  if (files.length === 0) {
    fail('The build produced no HTML, so the SEO audit looked at nothing.')
    return
  }

  const pages = files.map((file) => ({ url: urlOf(file), html: readFileSync(file, 'utf8') }))
  // Every URL the build produced, not only the ones with HTML in them.
  const known = new Set(produced.map(urlOf))

  const findings = [
    ...pages.flatMap((page) =>
      auditPage(page, {
        origin: ORIGIN,
        indexable: !NOT_INDEXABLE.has(page.url),
        structured: !NO_STRUCTURED_DATA.has(page.url),
      }).map((finding) => ({ url: page.url, ...finding })),
    ),
    // The 404 shell has no canonical, no description and no place in a sitemap,
    // and is audited above only for the rules that apply to any document.
    ...auditLinks(
      pages.filter((page) => page.url !== '/_not-found'),
      known,
    ),
    ...auditUniqueness(pages.filter((page) => !NOT_INDEXABLE.has(page.url))),
  ]

  const critical = findings.filter((finding) => finding.severity === 'critical')
  const warnings = findings.filter((finding) => finding.severity === 'warning')

  console.log(
    `SEO audit — ${pages.length} pages, ${critical.length} critical, ${warnings.length} warnings\n`,
  )

  for (const finding of [...critical, ...warnings]) {
    const label = finding.severity === 'critical' ? 'CRITICAL' : ' warning'
    console.log(`  ${label}  ${finding.url}  ${finding.rule}: ${finding.message}`)
  }

  if (critical.length === 0) {
    console.log(`\nNo critical findings across ${pages.length} pages.`)
    return
  }

  fail(
    `SEO audit: ${critical.length} critical finding(s) across ${new Set(critical.map((f) => f.url)).size} page(s).`,
  )
}

main()
