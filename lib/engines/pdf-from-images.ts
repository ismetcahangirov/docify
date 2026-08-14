/**
 * The `convert` arm of the pdf-lib engine: JPEG and PNG images in, one document
 * out, in the order the user dropped them.
 *
 * ## The pixels-to-points assumption
 *
 * A PDF page has a physical size; a bitmap does not. Nothing reliable in a JPEG
 * or a PNG says how large it is meant to print — the density fields are optional
 * in both formats, routinely wrong when present, and pdf-lib exposes pixel
 * counts only. So a density has to be assumed, and {@link POINTS_PER_PIXEL} is
 * it: one image pixel becomes one PDF point, which is 72 dpi.
 *
 * That is the identity mapping, because PDF user space is *defined* as 1/72
 * inch. It is the only assumption that introduces no scaling at all, and the
 * only one that round-trips: `PdfRenderOptions.dpi` defaults to 72 for the same
 * reason, so images → PDF → images through the pdfjs engine returns the original
 * pixel grid rather than a resampled approximation of it. Assuming 96 dpi
 * instead — the CSS reference pixel, i.e. "the size it looked on screen" —
 * would break both properties in exchange for matching one particular monitor.
 *
 * The assumption decides the page size under `pageSize: 'fit'` and nothing else.
 * On a named page the image is scaled to the paper, so the printed density is
 * whatever that scale works out to: a 3000 px photo across A4 lands near 390
 * dpi. That is the split the two settings exist for — `fit` for an album that
 * should keep every photo at its own size, a named size for anything going to a
 * printer that has opinions about paper.
 *
 * ## Why it never enlarges
 *
 * A small image on a named page is centred at its natural size rather than
 * stretched to the margins. Enlarging cannot add detail, so the alternative is a
 * full page of blur presented as a document, and the user who wanted that can
 * upscale deliberately with the resize operation first. It also matches what the
 * raster engines already do — `ImageOptions.enlarge` is off by default for the
 * same reason — so "Docify does not invent pixels" stays true across engines
 * rather than being an engine-by-engine surprise.
 *
 * ## What it does not trust
 *
 * `descriptor.supports()` gates on `task.from`, which is derived from the file
 * name, so a JPEG called `.png` routes here claiming to be a PNG. Every file is
 * therefore sniffed by its magic bytes rather than by its label, and a file that
 * is neither is rejected by name — see {@link embed}.
 */

import { PageSizes, PDFDocument, type PDFImage } from 'pdf-lib'

import type { PdfLayoutOptions } from './pdf-options'
import type { EngineInput, ProgressCallback } from './types'

/**
 * PDF points per image pixel — see the module header. Exported so the assumption
 * is asserted somewhere rather than only described.
 */
export const POINTS_PER_PIXEL = 1

/**
 * The named sizes, in points, taken from pdf-lib rather than typed out: these
 * are irrational millimetre conversions (A4 is 595.276 pt, not 595) and a
 * hand-rounded copy would drift from the library the pages are built with.
 * Every entry is portrait, which is what makes `landscape` a swap.
 */
const NAMED_PAGE_SIZES = {
  a3: PageSizes.A3,
  a4: PageSizes.A4,
  a5: PageSizes.A5,
  letter: PageSizes.Letter,
  legal: PageSizes.Legal,
} as const satisfies Readonly<Record<string, readonly [number, number]>>

type NamedPageSize = keyof typeof NAMED_PAGE_SIZES

const PNG_SIGNATURE = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a)
const JPEG_SIGNATURE = Uint8Array.of(0xff, 0xd8, 0xff)

/** A page box and the rectangle the image occupies on it, both in points. */
interface Placement {
  page: [number, number]
  image: { x: number; y: number; width: number; height: number }
}

/**
 * Builds the document. Matches `PdfOperation` in `./pdflib`, which is what lets
 * this module be driven directly by its own test with no engine around it.
 */
export async function imagesToPdf(
  input: EngineInput,
  signal: AbortSignal,
  onProgress: ProgressCallback,
): Promise<Blob> {
  throwIfAborted(signal)

  const { files } = input
  if (files.length === 0) {
    throw new Error(
      'Building a PDF needs at least one image, but none were given. Add a JPEG or a PNG and try again.',
    )
  }

  const layout = input.pdf?.layout
  const margin = marginOf(layout)
  const doc = await PDFDocument.create()

  for (const [index, file] of files.entries()) {
    throwIfAborted(signal)
    // Real fractions rather than a spinner: the loop below is the whole job, so
    // "image 3 of 12" is something the engine actually knows.
    onProgress(index / files.length)

    // One file is read at a time. Reading them all up front would hold every
    // source bitmap alongside every embedded copy, and this is the engine that
    // has to survive a 1 GB phone (`descriptor.supports` gates on nothing).
    const bytes = new Uint8Array(await file.arrayBuffer())
    throwIfAborted(signal)

    const image = await embed(doc, bytes, file, index)
    const placement = place(image, layout, margin)

    doc.addPage(placement.page).drawImage(image, placement.image)
  }

  // pdf-lib types the result with the default `ArrayBufferLike`, which `Blob`
  // will not take because a `SharedArrayBuffer` cannot back one. It allocates a
  // plain `ArrayBuffer`, so pinning it here restates a fact rather than asserting
  // one — the same pin `RgbaBitmap` carries in `./bitmap`.
  const saved = (await doc.save()) as Uint8Array<ArrayBuffer>
  throwIfAborted(signal)
  onProgress(1)

  return new Blob([saved], { type: 'application/pdf' })
}

/**
 * Embeds one image, choosing the decoder from the bytes.
 *
 * The rejection quotes the file and names the fix (CLAUDE.md §2.5). "Unsupported
 * image" would leave someone re-checking twelve holiday photos to find which one
 * their phone actually saved as HEIC.
 */
async function embed(
  doc: PDFDocument,
  bytes: Uint8Array,
  file: Blob,
  index: number,
): Promise<PDFImage> {
  if (startsWith(bytes, PNG_SIGNATURE)) return doc.embedPng(bytes)
  if (startsWith(bytes, JPEG_SIGNATURE)) return doc.embedJpg(bytes)

  throw new Error(
    `${nameOf(file, index)} is not a JPEG or a PNG, whatever its name says. A PDF ` +
      'can embed only those two, so convert it to PNG first and build the document from the result.',
  )
}

/**
 * Works out the page box and where the image sits on it.
 *
 * One rule covers both modes: the image occupies a content box inset by `margin`
 * on all four sides. Under `fit` the page is grown so that box is exactly the
 * image; under a named size the box is the paper minus the margins and the image
 * is scaled down into it, uniformly and never up, then centred.
 */
function place(image: PDFImage, layout: PdfLayoutOptions | undefined, margin: number): Placement {
  const natural = {
    width: image.width * POINTS_PER_PIXEL,
    height: image.height * POINTS_PER_PIXEL,
  }
  const pageSize = layout?.pageSize ?? 'fit'

  if (pageSize === 'fit') {
    // `orientation` is deliberately ignored here: a fitted page takes its shape
    // from the image, and rotating the paper under it would crop or letterbox
    // the very thing the mode exists to avoid.
    return {
      page: [natural.width + margin * 2, natural.height + margin * 2],
      image: { x: margin, y: margin, ...natural },
    }
  }

  const [width, height] = oriented(pageSize, layout?.orientation ?? 'portrait')
  const box = { width: width - margin * 2, height: height - margin * 2 }

  if (box.width <= 0 || box.height <= 0) {
    throw new Error(
      `A ${margin} pt margin on every side leaves no room on a ${Math.round(width)} × ` +
        `${Math.round(height)} pt page. Use a margin below ` +
        `${Math.floor(Math.min(width, height) / 2)} pt, or a larger page size.`,
    )
  }

  // The third term is the no-enlargement clamp — see the module header.
  const scale = Math.min(box.width / natural.width, box.height / natural.height, 1)
  const placed = { width: natural.width * scale, height: natural.height * scale }

  return {
    page: [width, height],
    image: { x: (width - placed.width) / 2, y: (height - placed.height) / 2, ...placed },
  }
}

/** The stored sizes are portrait, so landscape is a swap of the two axes. */
function oriented(size: NamedPageSize, orientation: 'portrait' | 'landscape'): [number, number] {
  const [width, height] = NAMED_PAGE_SIZES[size]

  return orientation === 'landscape' ? [height, width] : [width, height]
}

function marginOf(layout: PdfLayoutOptions | undefined): number {
  const margin = layout?.margin ?? 0

  if (!Number.isFinite(margin) || margin < 0) {
    throw new Error(
      `A margin of ${margin} pt is not a distance. Give a number of points from 0 upwards — ` +
        '72 pt is one inch.',
    )
  }

  return margin
}

/**
 * How to refer to a file in an error.
 *
 * `EngineInput.files` is typed as `Blob` because that is all the contract needs,
 * but the worker forwards the user's `File` objects, which carry the name that
 * makes a rejection actionable. The position is the fallback, not the default.
 */
function nameOf(file: Blob, index: number): string {
  const name: unknown = (file as { name?: unknown }).name

  return typeof name === 'string' && name.length > 0 ? `"${name}"` : `Image ${index + 1}`
}

function startsWith(bytes: Uint8Array, signature: Uint8Array): boolean {
  return bytes.length >= signature.length && signature.every((byte, index) => bytes[index] === byte)
}

function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new DOMException('The conversion was cancelled.', 'AbortError')
}
