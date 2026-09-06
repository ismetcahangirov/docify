/**
 * The half of ffmpeg.wasm this project calls, declared structurally.
 *
 * ## Why the core is driven directly, and `@ffmpeg/ffmpeg` is not used
 *
 * The published wrapper spawns a `Worker` of its own and talks to the core
 * across it. Every conversion here already runs inside a worker (CLAUDE.md
 * §2.2), so the wrapper would nest one worker inside another — supported, but
 * for no benefit, and with the wrapper's `new Worker(new URL(...))` needing to
 * survive bundling to a path it can still find. The core is an ordinary
 * Emscripten module with `FS`, `exec` and two callbacks; talking to it is what
 * the wrapper does anyway.
 *
 * ## What the vendored build is
 *
 * `@ffmpeg/core` 0.12.10, ffmpeg 5.1.4, configured with libx264, libx265,
 * libvpx, libmp3lame, libvorbis, libopus, libtheora and libwebp — every codec
 * Docify offers — and, importantly, `--disable-pthreads`. It is single-threaded
 * whatever the page's isolation, which is why the router emits `NO_ISOLATION`
 * for every ffmpeg job rather than only for an un-isolated page — see
 * `./ffmpeg.ts`. Lifting that needs the separate `@ffmpeg/core-mt` build, which
 * would double the 31 MB this already costs.
 *
 * ## Loading
 *
 * Fetched by URL from `public/vendor/ffmpeg/`, exactly as `./vips-runtime` does
 * and for the same reason: 31 MB must never be reachable by a bundler.
 */

/** Emscripten's MEMFS, as much of it as a job touches. */
export interface FfmpegFileSystem {
  writeFile(path: string, data: Uint8Array): void
  readFile(path: string): Uint8Array
  unlink(path: string): void
  readdir(path: string): string[]
}

/** One line ffmpeg wrote to its own stdout or stderr. */
export interface FfmpegLogMessage {
  type: string
  message: string
}

/** ffmpeg's own progress report, from inside the encoding loop. */
export interface FfmpegProgress {
  /** Fraction of the input consumed, where the duration is known. */
  progress: number
  /** Position in the output, in microseconds. */
  time: number
}

export interface FfmpegCore {
  FS: FfmpegFileSystem
  /** Runs one command. Returns ffmpeg's exit status: 0 for success. */
  exec(...args: string[]): number
  setLogger(logger: (message: FfmpegLogMessage) => void): void
  setProgress(handler: (progress: FfmpegProgress) => void): void
  /**
   * A deadline, in seconds, that ffmpeg checks from inside its own loop.
   *
   * The only way to interrupt a run: `exec` is one synchronous call into WASM,
   * so the worker's message loop cannot deliver anything while it is running.
   * Setting a deadline that has already passed makes ffmpeg give up at its next
   * check — see `./ffmpeg-run`.
   */
  setTimeout(seconds: number): void
  /** Clears the exit status and the deadline, ready for the next command. */
  reset(): void
}

/** The factory `ffmpeg-core.js` default-exports. */
export type FfmpegFactory = (config: Record<string, unknown>) => Promise<FfmpegCore>

/** How a job obtains a core. A parameter everywhere, so a test supplies a fake. */
export type FfmpegLoader = () => Promise<FfmpegCore>

/** Where `pnpm vendor` puts the files, and where the browser fetches them from. */
export const FFMPEG_ASSET_PATH = '/vendor/ffmpeg/'

/** Must stay in step with `FFMPEG_VENDORED_FILES` in the vendor script. */
export const FFMPEG_MODULE_FILE = 'ffmpeg-core.js'
export const FFMPEG_WASM_FILE = 'ffmpeg-core.wasm'

/**
 * Bytes the engine downloads the first time it is used, measured rather than
 * estimated.
 *
 * The router quotes this to the user in the `LARGE_DOWNLOAD` warning, so it has
 * to be the real number: 30.8 MB of WebAssembly plus 109 kB of loader.
 * `test/engines/ffmpeg-vendor.test.ts` re-measures the installed package, so an
 * upgrade that changes the size fails there rather than quietly making the
 * router's promise wrong.
 */
export const FFMPEG_LOAD_COST = 32_344_223

/**
 * The absolute, same-origin URL of the vendored module.
 *
 * `base` is a parameter so the rule — always this origin, never a CDN — can be
 * asserted without a document. Left out, it reads the worker's own location.
 */
export function ffmpegModuleUrl(base: string = globalThis.location?.origin ?? ''): string {
  // Exactly two bases cannot resolve a same-origin path: `''` is no location at
  // all — server rendering, or a test without one — and `'null'` is an opaque
  // origin serialised, which is what a sandboxed iframe, a data: document and a
  // file:// page report. `new URL()` rejects both with `Invalid URL`, which
  // points nowhere useful.
  if (base === '' || base === 'null') {
    throw new Error(
      'ffmpeg is served from this origin, and there is none to resolve ' +
        `${FFMPEG_ASSET_PATH}${FFMPEG_MODULE_FILE} against: server rendering has no location, ` +
        'and a sandboxed iframe, a data: document or a file:// page has an opaque origin.',
    )
  }

  return new URL(`${FFMPEG_ASSET_PATH}${FFMPEG_MODULE_FILE}`, base).href
}

/**
 * Boots the core.
 *
 * `locateFile` is passed explicitly rather than left to Emscripten's default:
 * the default resolves against the script's own directory, which is correct
 * today and silently wrong the moment the vendored files move. ffmpeg's own
 * chatter goes nowhere — it writes its whole banner and every frame statistic to
 * stderr, none of which is the user's problem; `./ffmpeg-run` attaches a logger
 * that keeps only what a failure needs.
 */
export async function loadFfmpegCore(): Promise<FfmpegCore> {
  const factory = await importFfmpegFactory()

  return factory({
    locateFile: (file: string) => `${FFMPEG_ASSET_PATH}${file}`,
    print: () => {},
    printErr: () => {},
  })
}

async function importFfmpegFactory(): Promise<FfmpegFactory> {
  // The specifier is a variable *and* explicitly excluded, so neither webpack
  // nor Turbopack follows it. That is what keeps 31 MB out of every chunk.
  const loaded: unknown = await import(
    /* webpackIgnore: true */ /* turbopackIgnore: true */ ffmpegModuleUrl()
  )

  const factory = (loaded as { default?: unknown }).default
  if (typeof factory !== 'function') {
    throw new Error(
      `${FFMPEG_ASSET_PATH}${FFMPEG_MODULE_FILE} did not export an ffmpeg factory. ` +
        'Run `node scripts/vendor-ffmpeg/cli.mjs` to refresh the vendored package.',
    )
  }

  return factory as FfmpegFactory
}
