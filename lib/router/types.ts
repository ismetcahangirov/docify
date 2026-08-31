/**
 * The vocabulary of the capability router.
 *
 * This module contains types only — no values, no imports, no side effects — so
 * that every consumer (router, engines, worker, UI) can import from it freely
 * without pulling anything into a bundle.
 *
 * Two rules shape everything here:
 *
 * 1. The router is a pure function: `route(task, inputBytes, caps)`. `Capabilities`
 *    is always a parameter, never probed inside the router, so the whole selection
 *    logic is testable without a browser.
 * 2. A rejection always explains itself. `message` and `suggestion` are required
 *    properties on the failing branch of `RouteResult`, so omitting either is a
 *    compile error rather than an empty dialog in front of the user.
 */

/** Every file format the app can read or write. */
export type FormatId =
  | 'jpg'
  | 'png'
  | 'webp'
  | 'avif'
  | 'gif'
  | 'bmp'
  | 'tiff'
  | 'svg'
  | 'heic'
  | 'ico'
  | 'pdf'
  | 'mp4'
  | 'webm'
  | 'mov'
  | 'mkv'
  | 'avi'
  | 'mp3'
  | 'wav'
  | 'ogg'
  | 'm4a'
  | 'flac'
  | 'aac'
  | 'zip'
  | 'rar'
  | '7z'
  | 'tar'

/** What the user asked to do with the file, beyond a plain format swap. */
export type Operation =
  | 'convert'
  | 'compress'
  | 'resize'
  | 'crop'
  | 'rotate'
  | 'flip'
  | 'merge'
  | 'split'
  | 'extract'
  | 'organize'
  | 'protect'
  | 'unlock'

/** A single unit of work: the `from → to → op` triple the router routes on. */
export interface ConversionTask {
  from: FormatId
  to: FormatId
  op: Operation
}

/**
 * The sizes `route()` accepts: one number for a single file, or one number per
 * file for a job made of several.
 *
 * A bare number rather than a one-element array for the common case, because
 * most conversions are one file and `route(task, file.size, caps)` should not
 * have to be wrapped. The two are interchangeable — `jobInput` normalises them
 * to the same {@link JobInput}.
 */
export type RouteInput = number | readonly number[] | readonly RouteFile[]

/**
 * One file as the router sees it: its size, and its decoded pixel count where
 * the caller could read one.
 *
 * `pixels` is what a byte count structurally cannot say. A decoded bitmap costs
 * `width × height × bytes-per-pixel` however well the file compressed, so a flat
 * screenshot and a photograph of the same dimensions cost the same memory and
 * differ a hundredfold in bytes — measured, in
 * `docs/router/memory-budget-measurement.md`. Omit it for anything that is not
 * a raster image, and for one whose header has not been read: absent means "no
 * pixel bound", never "no pixels", so a caller that cannot answer gets exactly
 * the routing it got before the field existed.
 *
 * Reading it is cheap and does not break the router's purity: `rasterSize()` in
 * `lib/engines/raster-size.ts` takes the dimensions out of the first few dozen
 * bytes of a header, on the main thread, before `route()` is called.
 */
export interface RouteFile {
  bytes: number
  /** `width × height` from the image header. */
  pixels?: number
}

/**
 * The input side of a job, reduced to the four numbers the budget reasons about.
 *
 * Both extremes are kept because engines differ in which one binds them. An
 * engine that opens every file at once is bound by `totalBytes`; one that works
 * through them in turn is bound by `largestBytes`; and `smallestBytes` is how a
 * zero-byte file hiding in a hundred-file merge is caught before anything is
 * downloaded.
 */
export interface JobInput {
  /** Sum of every file's size, in bytes. */
  totalBytes: number
  /** The largest single file, in bytes. Zero when there are no files. */
  largestBytes: number
  /** The smallest single file, in bytes. Zero when there are no files. */
  smallestBytes: number
  /** How many files the job names. */
  fileCount: number
  /**
   * Decoded pixels across every file, where the caller knew them. Zero means
   * nothing was said — see {@link RouteFile.pixels}.
   */
  totalPixels: number
  /** Decoded pixels of the single largest image, on the same terms. */
  largestPixels: number
}

/**
 * Which of a job's bytes an engine has live at the same time.
 *
 * - `all-at-once` — every input is open together, so the job's *total* is what
 *   costs: merging builds one object graph out of all of them, and a ZIP is
 *   written from every member.
 * - `one-at-a-time` — files are processed in turn and each is released before
 *   the next, so only the *largest* one has to fit.
 */
export type MemoryScope = 'all-at-once' | 'one-at-a-time'

/**
 * How an engine's peak memory relates to the job it is handed.
 *
 * `peak = factor × heldBytes + reserveBytes`
 *
 * The affine shape exists because a single multiple of the input cannot
 * describe every engine. pdf.js sizes its canvas from the requested DPI, so a
 * 13 kB vector PDF still allocates 8.0 MB of pixels for a US Letter page at
 * 150 dpi — six hundred times its input, against any factor anyone would write
 * down. That allocation does not scale with the file, so it belongs in
 * `reserveBytes` rather than in a factor that has to be wrong for one of the two
 * cases.
 */
export interface EngineMemory {
  /** Peak bytes held per byte of the input the engine has open. At least 1. */
  factor: number
  /** Which of a multi-file job's bytes the factor applies to. */
  holds: MemoryScope
  /**
   * Bytes the engine allocates that the input size does not predict: an output
   * buffer sized by resolution, or a parser baseline a tiny document pays in
   * full. Taken off the top of the device budget before the factor is applied.
   */
  reserveBytes: number
  /**
   * Bytes held per *decoded pixel*, added to what the byte factor predicts.
   *
   * The term that exists because the other two cannot express a decoded bitmap:
   * it is `width × height × 4` whatever the file compressed to, so no multiple
   * of the encoded size describes both a screenshot and a photograph. Zero for
   * an engine that never decodes to a bitmap, and it only ever applies when the
   * caller supplied {@link RouteFile.pixels}.
   *
   * Measured — `docs/router/browser-memory-measure.mjs` for the browser
   * engines, `memory-measure.mjs` for pdf-lib.
   */
  bytesPerPixel: number
}

/** Every processing backend the router can choose between. */
export type EngineId =
  'canvas' | 'vips' | 'heif' | 'pdflib' | 'pdfjs' | 'webcodecs' | 'ffmpeg' | 'zip' | 'libarchive'

/** Operating system family, as detected from the user agent. */
export type Platform = 'ios' | 'android' | 'desktop'

/** Browser engine family, as detected from the user agent. */
export type Browser = 'safari' | 'chromium' | 'firefox' | 'unknown'

/**
 * What this device can actually do. Probed once from the browser, cached in
 * sessionStorage, and handed to the router as a parameter.
 */
export interface Capabilities {
  /** SharedArrayBuffer is available, so ffmpeg.wasm can run multi-threaded. */
  crossOriginIsolated: boolean
  wasmSimd: boolean
  /** `navigator.deviceMemory`, or a conservative estimate where it is missing. */
  deviceMemoryGb: number
  /** `navigator.hardwareConcurrency`. */
  cores: number
  /** Both `VideoEncoder` and `VideoDecoder` are present. */
  webCodecsVideo: boolean
  /** Both `AudioEncoder` and `AudioDecoder` are present. */
  webCodecsAudio: boolean
  offscreenCanvas: boolean
  createImageBitmap: boolean
  platform: Platform
  browser: Browser
}

/** Why the router refused the job. Each code maps to its own user-facing copy. */
export type RejectionCode =
  'FILE_TOO_LARGE' | 'UNSUPPORTED_PAIR' | 'DEVICE_TOO_WEAK' | 'CODEC_UNAVAILABLE' | 'EMPTY_INPUT'

/** The job will run, but the user should know something about how. */
export type WarningCode = 'SLOW_PATH' | 'QUALITY_LOSS' | 'LARGE_DOWNLOAD' | 'NO_ISOLATION'

export interface Warning {
  code: WarningCode
  message: string
}

/** The router picked an engine. */
export interface RouteSuccess {
  ok: true
  engine: EngineId
  /** Short user-facing explanation: "Hardware-accelerated (WebCodecs)". */
  reason: string
  /** Download size of the engine binary, in bytes. */
  loadCost: number
  warnings: Warning[]
}

/**
 * The router refused the job. Both explanation fields are required, so a
 * rejection without them does not compile.
 */
export interface RouteRejection {
  ok: false
  code: RejectionCode
  /** What went wrong, in the user's terms and with concrete numbers. */
  message: string
  /** A concrete, actionable next step. May never be empty or generic. */
  suggestion: string
}

/** Discriminated on `ok`, so consumers narrow with a single check. */
export type RouteResult = RouteSuccess | RouteRejection
