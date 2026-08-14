/**
 * Loading wasm-vips, and the sliver of its API this project actually uses.
 *
 * ## Why the module is fetched by URL rather than imported
 *
 * wasm-vips is Emscripten output: it locates `vips.wasm` and its side modules
 * relative to its own `import.meta.url`, and it starts its pthread pool with
 * `new Worker(new URL('vips-es6.js', import.meta.url), { type: 'module' })`.
 * Handing that to a bundler produces a chunk whose sibling files no longer sit
 * where the runtime expects them, and the failure only shows up in production.
 *
 * So the package is copied verbatim into `public/vendor/wasm-vips/` by
 * `scripts/vendor-wasm-vips.mjs` and loaded from there at run time. Three things
 * follow, all of them wanted:
 *
 * - The 5 MB binary cannot reach any bundle, because no bundler ever sees it
 *   (CLAUDE.md §2.3). `webpackIgnore` / `turbopackIgnore` say so explicitly.
 * - Everything is same-origin, so nothing is fetched from a CDN
 *   (CLAUDE.md §3) and `Cross-Origin-Embedder-Policy: require-corp` is satisfied
 *   without a CORP header on the assets.
 * - Emscripten's own relative resolution keeps working, unmodified.
 *
 * ## Why AVIF and HEIC cost extra
 *
 * libheif and AOM are built as a *side module*: `vips-heif.wasm` is 3.3 MB on
 * top of the 4.9 MB base and is loaded only when a job actually names AVIF or
 * HEIC. That is why {@link VIPS_BASE_LOAD_COST} — what every vips job pays — is
 * the descriptor's `loadCost`, and {@link VIPS_HEIF_LOAD_COST} is charged on top
 * for the pairs that need it.
 */

/** Where `scripts/vendor-wasm-vips.mjs` puts the package, as a URL path. */
export const VIPS_ASSET_PATH = '/vendor/wasm-vips/'

export const VIPS_MODULE_FILE = 'vips-es6.js'
export const VIPS_CORE_WASM = 'vips.wasm'
/** The libheif + AOM side module, which is what decodes and encodes AVIF. */
export const VIPS_HEIF_WASM = 'vips-heif.wasm'

/** Everything the vendor script copies. The order is the download order. */
export const VIPS_ASSETS: readonly string[] = Object.freeze([
  VIPS_MODULE_FILE,
  VIPS_CORE_WASM,
  VIPS_HEIF_WASM,
])

/**
 * Bytes every vips job downloads: the JS shim plus the core WASM.
 *
 * Measured against wasm-vips 0.0.18, and pinned by a test that re-measures the
 * installed package — so a version bump that changes the size fails there rather
 * than quietly making the router's cost model wrong.
 */
export const VIPS_BASE_LOAD_COST = 5_164_238

/** Bytes an AVIF or HEIC job downloads on top of {@link VIPS_BASE_LOAD_COST}. */
export const VIPS_HEIF_LOAD_COST = 3_475_845

/**
 * The half of the wasm-vips surface this project uses.
 *
 * Declared structurally instead of importing `wasm-vips`' own 260 kB `.d.ts`,
 * for two reasons: the module is fetched by URL and therefore has no static
 * type to import, and a hand-written interface this small can be satisfied by a
 * fake in a unit test, which is what lets the engine be tested without a
 * browser or a WASM runtime.
 */
export interface VipsImage {
  readonly width: number
  readonly height: number
  /** Set to `true` to make libvips abandon the pipeline at its next check. */
  kill: boolean
  /** Called with `0..100` as libvips evaluates. */
  onProgress: (percent: number) => void
  writeToBuffer(suffix: string, options?: Record<string, unknown>): Uint8Array
  /** Embind handles are not garbage collected; every image must be released. */
  delete(): void
}

export interface VipsImageStatic {
  newFromBuffer(
    data: Uint8Array,
    stringOptions?: string,
    options?: Record<string, unknown>,
  ): VipsImage
  thumbnailBuffer(data: Uint8Array, width: number, options?: Record<string, unknown>): VipsImage
}

export interface VipsModule {
  readonly Image: VipsImageStatic
  /** Drops caches and stops libvips' background threads. */
  shutdown(): void
}

/** The Emscripten factory `vips-es6.js` default-exports. */
export type VipsFactory = (config: Record<string, unknown>) => Promise<VipsModule>

/**
 * How {@link createRunner} obtains a module. A parameter everywhere it is used,
 * so a test can supply a fake instead of a 5 MB binary.
 */
export type VipsLoader = (dynamicLibraries: readonly string[]) => Promise<VipsModule>

/**
 * The absolute, same-origin URL of the vendored Emscripten module.
 *
 * `base` is a parameter so the rule — always this origin, never a CDN — can be
 * asserted without a document. Left out, it reads the worker's own location.
 */
export function vipsModuleUrl(base: string = globalThis.location?.origin ?? ''): string {
  // Exactly two bases cannot resolve a same-origin path, and `location.origin`
  // yields nothing else: `''` is no location at all — server rendering, or a
  // test without one — and `'null'` is an opaque origin serialised, which is
  // what a sandboxed iframe, a data: or srcdoc document, and a file:// page
  // report. `new URL()` rejects both with `Invalid URL`, which points nowhere
  // useful, so both are named here instead.
  if (base === '' || base === 'null') {
    throw new Error(
      'wasm-vips is served from this origin, and there is none to resolve ' +
        `${VIPS_ASSET_PATH}${VIPS_MODULE_FILE} against: server rendering has no location, and a ` +
        'sandboxed iframe, a data: document or a file:// page has an opaque origin.',
    )
  }

  return new URL(`${VIPS_ASSET_PATH}${VIPS_MODULE_FILE}`, base).href
}

/**
 * Boots libvips with exactly the side modules the job needs.
 *
 * `locateFile` is passed explicitly rather than left to Emscripten's default:
 * the default resolves against the script's own directory, which is correct
 * today and silently wrong the moment the vendored files move.
 */
export async function loadVips(dynamicLibraries: readonly string[]): Promise<VipsModule> {
  const factory = await importVipsFactory()

  return factory({
    dynamicLibraries: [...dynamicLibraries],
    locateFile: (file: string) => `${VIPS_ASSET_PATH}${file}`,
    // libvips writes warnings to stderr for things a converter recovers from —
    // an unknown EXIF tag, a truncated final scan. They are not the user's
    // problem and they are not ours, so they do not reach the console.
    print: () => {},
    printErr: () => {},
  })
}

async function importVipsFactory(): Promise<VipsFactory> {
  // The specifier is a variable *and* explicitly excluded, so neither webpack
  // nor Turbopack follows it. That is what keeps the binary out of every chunk.
  const loaded: unknown = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ vipsModuleUrl()
  )

  const factory = (loaded as { default?: unknown }).default
  if (typeof factory !== 'function') {
    throw new Error(
      `${VIPS_ASSET_PATH}${VIPS_MODULE_FILE} did not export a wasm-vips factory. ` +
        'Run `node scripts/vendor-wasm-vips.mjs` to refresh the vendored package.',
    )
  }

  return factory as VipsFactory
}
