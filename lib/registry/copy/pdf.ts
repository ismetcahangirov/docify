/**
 * Copy for the three conversions that start from a PDF.
 *
 * A PDF is a description of a printed page, so every conversion out of one is a
 * different answer to "which part of the page did you actually want" — the
 * picture, the sharpness, or the words.
 */

import type { PairCopy } from './types'

export const PDF_COPY: Readonly<Record<string, PairCopy>> = {
  'pdf-to-jpg': {
    h1: 'PDF to JPG, every page as a picture you can post anywhere',
    intro:
      'Sometimes a page needs to be an image: to attach to a chat message, to drop into a slide, to upload to a form that only accepts pictures. Each page of the document is rendered at the resolution you choose and saved as its own JPG, in page order.',
    steps: [
      'Add the PDF. Multi-page documents are expected, not a special case.',
      'Choose a resolution. 150 dpi is right for screen use; 300 dpi if the image will be printed or read closely.',
      'Download the pages individually, or take the whole document as one ZIP.',
    ],
    faq: [
      {
        q: 'Do I get one file per page?',
        a: 'Yes. A twelve-page document produces twelve JPGs, numbered in page order, and the batch download packs them into a single ZIP.',
      },
      {
        q: 'What resolution should I pick?',
        a: '150 dpi is legible on screen and keeps files small. 300 dpi matches print and roughly quadruples both the pixel count and the file size.',
      },
      {
        q: 'Why is the text slightly fuzzy?',
        a: 'Two reasons compound: the page is being rasterised, so vector text becomes pixels, and JPEG softens the hard edges those pixels form. Raise the resolution and the quality, or use PNG for documents that are mostly text.',
      },
      {
        q: 'Can I extract just one page?',
        a: 'Every page is rendered, and you download only the ones you want — the result panel lists them separately.',
      },
    ],
    note: 'A PDF page has no resolution of its own: it is described in points, at 72 to the inch, and a renderer decides how many pixels that becomes. That is why the dpi setting here is a genuine choice rather than a property being read from the file.',
  },

  'pdf-to-png': {
    h1: 'PDF to PNG for pages with text that has to stay sharp',
    intro:
      'For documents, diagrams, invoices and anything with small lettering, PNG is the better rasterisation target. It is lossless, so the hard black-on-white edges that make text readable survive exactly, with none of the ringing and halos that JPEG leaves around every character on a page.',
    steps: [
      'Add the PDF files, a whole folder at once if you like; nothing leaves your device.',
      'Choose a resolution — 150 dpi for screen, 300 dpi if the page will be zoomed or printed.',
      'Download the pages, or take the document as a single ZIP.',
    ],
    faq: [
      {
        q: 'Why choose PNG over JPG here?',
        a: 'Because text is the worst case for JPEG. Its block-based compression produces visible ringing around letterforms, and PNG has none of it. The trade is file size.',
      },
      {
        q: 'How much larger are the files?',
        a: 'Typically three to ten times the JPG equivalent for a text page. For a page dominated by a photograph, the gap is wider still and JPG is the better choice.',
      },
      {
        q: 'Will the PNG have a transparent background?',
        a: 'No. Pages are rendered onto white, which is what a page is. Rendering onto transparency would make most documents unreadable against a dark background.',
      },
      {
        q: 'Is this good enough for optical character recognition?',
        a: 'Yes, and it is the right target for it — render at 300 dpi and PNG will give the OCR engine the cleanest possible edges to work from.',
      },
    ],
    note: 'PDF text is usually stored as glyph references into an embedded font, not as an image. Rasterising discards that structure entirely, which is why a PNG of a page cannot be searched and a text extraction can.',
  },

  'pdf-to-txt': {
    h1: 'PDF to TXT, the words with the document thrown away',
    intro:
      'When you need what a document says rather than how it looks — to search it, quote it, paste it into a spreadsheet or feed it to another tool — extracting the text is faster than fighting the layout. What comes out is every character the PDF actually contains, in reading order, and nothing else.',
    steps: [
      'Add the PDF you want the words out of.',
      'Convert. The text layer is read directly; nothing is rendered and nothing is recognised.',
      'Download the .txt file and use it wherever plain text is wanted.',
    ],
    faq: [
      {
        q: 'Why is my file empty?',
        a: 'Because the PDF is a scan. A scanned document is a picture of a page with no text layer at all, and extracting from it correctly produces nothing. Recovering those words needs optical character recognition, which is a different operation entirely.',
      },
      {
        q: 'What happens to tables and columns?',
        a: 'They flatten. A PDF stores text as positioned fragments rather than as rows and columns, so the reading order is reconstructed from geometry and a complex layout will come out in an order that surprises you.',
      },
      {
        q: 'Are images, fonts and formatting kept?',
        a: 'None of them. A text file holds characters and line breaks and has nowhere to put anything else — that is what makes it universally readable.',
      },
      {
        q: 'Will it work on a password-protected PDF?',
        a: 'Only once the protection is removed. A document encrypted against opening cannot have its text read until it is unlocked with the password.',
      },
    ],
    note: 'PDF stores text as glyph codes plus positions, and the mapping back to actual characters lives in an optional table called ToUnicode. A document generated without one extracts as convincing gibberish — the right shapes with the wrong character codes underneath.',
  },
}
