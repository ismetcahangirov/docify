/**
 * Types for the libheif build Docify loads.
 *
 * `libheif-js` ships an emscripten `.d.ts` for the raw C bindings, but it
 * declares neither the `HeifDecoder` wrapper — which the package adds in
 * hand-written post-JS — nor this entry point, and the package has no `types`
 * field, so TypeScript sees the import as an implicit `any`. CLAUDE.md §5.3
 * does not allow that, so the surface Docify actually calls is declared here,
 * and nothing else: four methods, no bindings, no heap views.
 *
 * The specifier is deep on purpose. `libheif-js` publishes three builds, and
 * this is the only one that fits the invariants:
 *
 * - `libheif-js` (the default entry) is the pure-JavaScript fallback, 2.1 MB
 *   and far slower than WASM.
 * - `libheif-js/wasm` fetches `libheif.wasm` at run time by a path relative to
 *   the script, which no bundler rewrites correctly.
 * - `libheif-wasm/libheif-bundle.mjs` carries the WASM binary inside the module
 *   as base64. It is real ESM, it is self-contained, and it therefore needs no
 *   CDN and no separate asset route — CLAUDE.md §3 forbids the first and §2.3
 *   is easier to hold with the second. It is a published entry point: the
 *   package lists `libheif-wasm` in `files` and documents this build in its
 *   README.
 */
declare module 'libheif-js/libheif-wasm/libheif-bundle.mjs' {
  /**
   * The buffer libheif renders into. Structurally an `ImageData`, which is what
   * the library's browser examples pass, but declared on its own so that
   * nothing here depends on the DOM lib.
   */
  export interface LibheifImageData {
    width: number
    height: number
    data: Uint8ClampedArray
  }

  export interface LibheifImage {
    get_width(): number
    get_height(): number
    /** True for the image a gallery would show, which need not be the first. */
    is_primary(): boolean
    /**
     * Renders into `target`, then calls `done` — asynchronously — with the same
     * object, or with `null` if the image could not be rendered.
     */
    display(target: LibheifImageData, done: (result: LibheifImageData | null) => void): void
    /** Releases the WASM-side handle. Every image `decode` returns needs this. */
    free(): void
  }

  export interface LibheifDecoder {
    /** Answers `[]` — rather than throwing — for input it cannot parse. */
    decode(data: Uint8Array): LibheifImage[]
  }

  export interface Libheif {
    HeifDecoder: new () => LibheifDecoder
  }

  /**
   * Instantiates the module. The union is not hedging: this build embeds the
   * binary and compiles it synchronously, so it answers with the module itself,
   * while the emscripten factory it wraps is typed as returning a promise.
   * Awaiting the result is correct for both.
   */
  export default function createLibheif(): Libheif | Promise<Libheif>
}
