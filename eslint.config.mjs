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
      // Agent infrastructure, not application code: the hook scripts under
      // `.claude/hooks/` and the notes under `.claude/memory/` are written and
      // rewritten by the hooks themselves, under their own conventions. They
      // are deliberately outside the lint and format surface. Mirrored in
      // .prettierignore. See issue #7.
      '.claude/**',
    ],
  },
  ...compat.extends('next/core-web-vitals', 'next/typescript'),
  // Must stay last: switches off every ESLint rule that would disagree with
  // Prettier, so the two tools never report conflicting fixes.
  prettier,
]

export default eslintConfig
