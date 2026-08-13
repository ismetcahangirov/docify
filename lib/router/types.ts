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
