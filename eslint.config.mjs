import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { FlatCompat } from '@eslint/eslintrc'
import prettier from 'eslint-config-prettier/flat'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

const compat = new FlatCompat({ baseDirectory: __dirname })

const eslintConfig = [
  {
    ignores: [
      '.next/**',
      'out/**',
      'build/**',
      'coverage/**',
      'next-env.d.ts',
      // Third-party WASM engines copied out of node_modules by `pnpm vendor`.
      // Emscripten output, served verbatim: linting it is meaningless and
      // formatting it would change bytes the runtime depends on.
      'public/vendor/**',
      // Agent infrastructure, not application code: the hook scripts under
      // `.claude/hooks/` and the notes under `.claude/memory/` are written and
      // rewritten by the hooks themselves, under their own conventions. They
      // are deliberately outside the lint and format surface. Mirrored in
      // .prettierignore. See issue #7.
      '.claude/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  {
    /*
     * `no-html-link-for-pages` assumes a soft navigation is always the better
     * one. On this site it is sometimes the wrong one, in a way that breaks the
     * product rather than merely slowing it down.
     *
     * `/convert/*` and `/tools/*` are served with `Cross-Origin-Opener-Policy`
     * and `Cross-Origin-Embedder-Policy` so that `SharedArrayBuffer` — and
     * therefore multi-threaded ffmpeg.wasm and wasm-vips — is available. Those
     * headers are evaluated when the *document* is created, so a `next/link`
     * navigation carries the previous page's isolation across the boundary: a
     * soft navigation from a marketing page into a converter produces a
     * converter that cannot instantiate its engines, and one in the other
     * direction leaves a marketing page isolated for no reason.
     *
     * Every cross-boundary link is therefore a plain `<a href>`, deliberately,
     * and the reasoning is written out in the header of `next.config.ts`.
     * Leaving the rule on would mean an inline disable comment on each of them
     * and a new one on every link added afterwards.
     */
    rules: { '@next/next/no-html-link-for-pages': 'off' },
  },
  // Must stay last: switches off every ESLint rule that would disagree with
  // Prettier, so the two tools never report conflicting fixes.
  prettier,
]

export default eslintConfig
