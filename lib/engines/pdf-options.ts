/**
 * Everything the PDF engines can be told to do, as types only.
 *
 * `EngineInput` carries one optional slot per family of settings — `image` for
 * the raster engines, `pdf` for these — rather than one catch-all record. A
 * shared bag would have to be loose enough to hold a page range and a JPEG
 * quality at once, which means every reader would be guessing.
 *
 * The interfaces below are namespaced by operation on purpose: `split` never
 * reads `layout`, and keeping them apart means an operation can gain a setting
 * without touching the type another operation depends on.
 *
 * Page numbers are 1-based wherever a *user* supplies them, because that is
 * what a page range means to a person. Everything downstream converts to 0-based
 * indices through `./pdf-pages`, and nothing else does that arithmetic by hand.
 */

/** Clockwise degrees. Any other value is a bug, not a rounding job. */
export type PageRotation = 0 | 90 | 180 | 270

/** How a multi-page document is cut up. */
export interface PdfSplitOptions {
  /**
   * `ranges` keeps the listed spans as documents; `every-page` ignores `ranges`
   * and emits one document per page.
   */
  mode?: 'ranges' | 'every-page'
  /** 1-based range spec, e.g. `"1-3, 7, 12-"`. Required when `mode` is `ranges`. */
  ranges?: string
}

/** Reordering, rotating and deleting pages of one document. */
export interface PdfOrganizeOptions {
  /**
   * The pages to keep, in output order, 1-based. Absent means "every page, in
   * the order it already has" — which is what a rotate-only job asks for.
   */
  order?: readonly number[]
  /**
   * Rotation per 1-based *source* page number. Applied on top of the rotation
   * the page already carries rather than replacing it, so a page scanned
   * sideways stays consistent with what the user saw in the thumbnail.
   */
  rotate?: Readonly<Record<number, PageRotation>>
}

/** Rasterising pages to images. */
export interface PdfRenderOptions {
  /** Output resolution. PDF user space is 72 dpi, so 72 renders 1:1. */
  dpi?: number
  /** 1-based range spec limiting which pages are rendered. Absent means all. */
  pages?: string
  /** JPEG quality in `0..1`. Ignored when the target format is PNG. */
  quality?: number
}

/** Page geometry when images are assembled into a document. */
export interface PdfLayoutOptions {
  /**
   * A named ISO/US size, or `fit` to give every page the exact dimensions of
   * the image it holds — the right default for a photo album, and the wrong one
   * for anything destined for a printer.
   */
  pageSize?: 'fit' | 'a4' | 'a3' | 'a5' | 'letter' | 'legal'
  /** Ignored when `pageSize` is `fit`, which takes its orientation from the image. */
  orientation?: 'portrait' | 'landscape'
  /** Margin around the image, in points (1/72 inch). */
  margin?: number
}

/** Reading a document's words out as plain text. */
export interface PdfTextOptions {
  /** 1-based range spec limiting which pages are read. Absent means all. */
  pages?: string
}

/** Adding a password to a document. */
export interface PdfProtectOptions {
  /**
   * The password the document will ask for when it is opened.
   *
   * Required: there is no default that would not be a lie. It never leaves the
   * device — the whole encryption happens in the worker (CLAUDE.md §2.1).
   */
  password?: string
  /**
   * A second password that also opens the document. Defaults to {@link password}.
   *
   * PDF calls this the *owner* password and uses it to gate permissions. Docify
   * writes every document with all permissions allowed — see `./pdf-protect` for
   * why a lock every reader may ignore is not worth offering — so its only
   * effect here is to give a second way in, which is what a team sharing one
   * document usually wants.
   */
  ownerPassword?: string
}

/** Removing a password from a document. */
export interface PdfUnlockOptions {
  /**
   * The password that opens the document. Either the open password or the owner
   * password will do; both derive the same file key.
   *
   * An empty password is the common case rather than an oversight: a document
   * with restrictions but no open password has one, and that is what most people
   * reach for an unlocker to remove.
   */
  password?: string
}

/**
 * The `pdf` slot of `EngineInput`. Every field is optional: a job with no
 * settings at all is a valid job, and each operation documents its own defaults
 * next to the code that applies them.
 */
export interface PdfOptions {
  split?: PdfSplitOptions
  organize?: PdfOrganizeOptions
  render?: PdfRenderOptions
  text?: PdfTextOptions
  layout?: PdfLayoutOptions
  protect?: PdfProtectOptions
  unlock?: PdfUnlockOptions
}
