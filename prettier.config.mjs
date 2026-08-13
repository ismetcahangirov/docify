/**
 * Formatting rules for Docify.
 *
 * These values were reverse-engineered from the code already in the repository
 * (`app/`, `scripts/`, and the root config files) so that adopting Prettier
 * reformats nothing that was written before it. Everything else is left at the
 * Prettier 3 default.
 *
 * @type {import('prettier').Config}
 */
const config = {
  // No semicolons, single quotes in TS/JS, double quotes in JSX attributes.
  semi: false,
  singleQuote: true,
  jsxSingleQuote: false,

  // Two-space indentation, 100-column wrap — matches app/ and scripts/.
  tabWidth: 2,
  useTabs: false,
  printWidth: 100,

  // LF everywhere: the project is developed on Windows and built on Linux CI.
  endOfLine: 'lf',
}

export default config
