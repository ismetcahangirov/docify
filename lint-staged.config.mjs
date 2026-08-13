/**
 * Pre-commit tasks, run by `.husky/pre-commit` against staged files only.
 *
 * The two globs overlap on purpose, so the hook runs `--concurrent false`
 * (see .husky/pre-commit): ESLint must finish before Prettier, otherwise a
 * rule autofix lands unformatted.
 *
 * Prettier is matched with `*` rather than an extension list so that the
 * hook's surface can never drift from `pnpm format:check`. `--ignore-unknown`
 * skips file types Prettier has no parser for, and .prettierignore skips the
 * rest — including everything under `.claude/`. `--no-warn-ignored` does the
 * same job for ESLint.
 *
 * @type {import('lint-staged').Configuration}
 */
const config = {
  '*.{js,jsx,mjs,cjs,ts,tsx,mts,cts}': 'eslint --fix --no-warn-ignored',
  '*': 'prettier --write --ignore-unknown',
}

export default config
