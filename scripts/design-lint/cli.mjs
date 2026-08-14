#!/usr/bin/env node
/**
 * Design-prohibition gate — `pnpm lint:design`, and the second half of
 * `pnpm lint`.
 *
 * CLAUDE.md section 3 forbids glassmorphism, blue and purple hues, decorative
 * gradients and raw hex codes outside the `@theme` palette. ESLint cannot carry
 * these: three of the four also have to hold in app/globals.css, which is not
 * JavaScript and is not part of `eslint .` at all. So the gate is a checker of
 * its own, wired into the same `lint` script — and therefore into the same CI
 * job — as ESLint.
 *
 * Exits non-zero on the first file that violates anything, after reporting all
 * of them.
 */
import { collectFiles, scanSurface, SURFACE_ROOTS } from './scan.mjs'

function main() {
  const violations = scanSurface()
  const scanned = collectFiles().length

  if (violations.length === 0) {
    console.log(
      `design-lint: ${scanned} file${scanned === 1 ? '' : 's'} in ` +
        `${SURFACE_ROOTS.join('/, ')}/ — no prohibited styles.`,
    )
    return
  }

  console.error('')
  for (const { file, line, column, rule, text, message } of violations) {
    console.error(`${file}:${line}:${column}  ${rule}  ${text}\n    ${message}`)
    // Surfaces the violation inline on the pull request diff, not only in the log.
    if (process.env.GITHUB_ACTIONS === 'true') {
      console.log(`::error file=${file},line=${line},col=${column}::${rule}: ${text} — ${message}`)
    }
  }

  const count = violations.length
  console.error(
    `\ndesign-lint: ${count} prohibited style${count === 1 ? '' : 's'}. ` +
      'See CLAUDE.md section 3 and the docify-design skill.',
  )
  process.exitCode = 1
}

main()
