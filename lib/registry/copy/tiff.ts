/**
 * Copy for the five conversions that start from a TIFF.
 *
 * A TIFF almost always comes out of a scanner, a microscope or a camera’s raw
 * export, so the reader here already has a large, correct file and wants a
 * smaller or more portable one. Every page below is written to somebody
 * carrying something heavy.
 */

import type { PairCopy } from './types'

export const TIFF_COPY: Readonly<Record<string, PairCopy>> = {
  'tiff-to-jpg': {
    h1: 'TIFF to JPG, taking a scanner’s output down to a sendable size',
    intro:
      'Scanners, microscopes and prepress exports write TIFF because it is lossless, and the files are enormous — a single scanned page can run past 50 MB. JPEG makes the same image emailable, uploadable and openable on a phone, at a compression cost you can choose.',
    steps: [
      'Add the TIFF files. Large ones are fine; nothing is uploaded anywhere.',
      'Choose a quality. 90 for anything you might print, 80 for on-screen viewing and email.',
      'Download individually, or take the whole scan batch as one ZIP.',
    ],
    faq: [
      {
        q: 'How much smaller will the JPG be?',
        a: 'Commonly twenty to fifty times for a scanned page. TIFF stores every pixel and JPEG stores an approximation, and on a document that approximation is very close.',
      },
      {
        q: 'Will scanned text stay readable?',
        a: 'At quality 90 and above, yes. Below about 75 the artefacts around letterforms start to interfere with optical character recognition, so keep it high if the scan is going to be read by software.',
      },
      {
        q: 'What happens to a multi-page TIFF?',
        a: 'Only the first page is converted. For a whole multi-page scan, PDF is the target that keeps the pages together.',
      },
      {
        q: 'Is the colour profile carried across?',
        a: 'Yes, when the TIFF has one. That matters on scans destined for print, where an unprofiled file is guessed at.',
      },
    ],
    note: 'Many scanners write TIFF at 16 bits per channel to preserve shadow detail. JPEG is 8-bit only, so that extra depth is discarded here — which is invisible on a document and can matter on a negative scan.',
  },

  'tiff-to-png': {
    h1: 'TIFF to PNG, losing the size without losing a pixel',
    intro:
      'PNG is the conversion for a scan that has to stay exact but has to be opened by ordinary software. Both formats are lossless, so nothing changes about the image; what changes is that a browser, a phone and every editor written since 1996 will display the result.',
    steps: [
      'Add the TIFF files from your scanner or camera.',
      'Convert. Both formats are lossless, so there is nothing to trade away.',
      'Grab the PNG from the results list, which appears as soon as the first job lands.',
    ],
    faq: [
      {
        q: 'Is the image truly identical?',
        a: 'For 8-bit sources, pixel for pixel. A 16-bit TIFF is reduced to 8 bits per channel here, which is invisible on most content and does discard depth a specialist workflow may want.',
      },
      {
        q: 'Will the PNG be smaller?',
        a: 'Usually. PNG applies a per-row prediction filter before compressing, which TIFF generally does not, so the same lossless data packs tighter.',
      },
      {
        q: 'Why not just use TIFF?',
        a: 'Because browsers do not display it, most phone galleries will not open it, and a lot of web software rejects the extension outright.',
      },
      {
        q: 'Does the alpha channel survive?',
        a: 'Yes, where the TIFF has one. PNG stores transparency natively and precisely.',
      },
    ],
    note: 'TIFF can store an image in strips or in tiles, and some scanners choose tiles for very large scans. Both are handled here, but it is the usual reason one TIFF opens in a piece of software and another does not.',
  },

  'tiff-to-webp': {
    h1: 'TIFF to WebP to put a scan on the web without a 50 MB download',
    intro:
      'Publishing scanned documents, artwork or archival photographs means moving off TIFF, which no browser renders. WebP is the target that gets both things at once: a file small enough to serve and quality high enough that the detail in the scan survives the trip.',
    steps: [
      'Add the TIFFs you want to publish.',
      'Pick a quality — 85 or above for documents with fine text, 75 for photographic material.',
      'Download the WebP output. Nothing is kept here once you close the tab.',
    ],
    faq: [
      {
        q: 'Should I use lossy or lossless WebP?',
        a: 'Lossy for photographs and artwork; a high quality setting keeps it visually identical. For a line-art scan or a document, the lossless mode keeps the edges crisp and is still far smaller than the TIFF.',
      },
      {
        q: 'Is there a size limit?',
        a: 'WebP cannot exceed 16,383 pixels on either side. Very large scans and panoramas hit that ceiling and need AVIF or a downscale first.',
      },
      {
        q: 'How much smaller than the TIFF?',
        a: 'Typically thirty to a hundred times, depending on quality and content. Scans compress well because most of the page is one colour.',
      },
      {
        q: 'Do I lose the colour profile?',
        a: 'No. WebP carries an ICC profile chunk and it is preserved, which keeps archival colour accurate in the browser.',
      },
    ],
    note: 'A 600 dpi A4 scan is about 35 megapixels, which is more than most cameras produce. That resolution is why scanner TIFFs are so large, and why downscaling before converting is often the bigger saving of the two.',
  },

  'tiff-to-avif': {
    h1: 'TIFF to AVIF for an archive that has to be served, not just stored',
    intro:
      'Digitisation projects end up with terabytes of TIFF and a website that has to show it. AVIF is the smallest thing a browser will render, holds ten bits per channel so shadow detail survives, and handles the very large dimensions that scanning produces. Encoding is slow, which is fine for a one-time pass.',
    steps: [
      'Add the TIFF scans. Expect this to take a few seconds per megapixel.',
      'Choose a quality — 65 to 75 preserves scanned detail comfortably.',
      'Download once the batch has finished.',
    ],
    faq: [
      {
        q: 'Does AVIF keep the 16-bit depth of my scans?',
        a: 'Not all of it. AVIF supports 10 and 12 bits per channel, so a 16-bit TIFF is reduced — still far better than the 8 bits a JPEG or PNG would allow.',
      },
      {
        q: 'Are there dimension limits like WebP’s?',
        a: 'No meaningful ones. AVIF handles very large images, which is exactly why it suits scans that exceed WebP’s 16,383-pixel ceiling.',
      },
      {
        q: 'Should the TIFFs be kept?',
        a: 'Yes. AVIF is the access copy; the TIFF remains the preservation master. Archival practice is to serve the small one and never delete the big one.',
      },
      {
        q: 'Why is it so slow?',
        a: 'AV1 encoding searches an enormous space of prediction modes, and a 35-megapixel scan is a lot of blocks. The time is the compression.',
      },
    ],
    note: 'AVIF inherits AV1’s film grain synthesis, which describes grain statistically instead of encoding it. On scanned film that removes the single most expensive thing in the image and can halve the file on its own.',
  },

  'tiff-to-gif': {
    h1: 'TIFF to GIF for equipment that stopped being updated',
    intro:
      'Some laboratory instruments, older document viewers and embedded terminals accept GIF alone. A scan converted into one is squeezed into 256 colours, which is fine for line art and hard on a photograph. It is worth doing when the receiving system leaves you no other choice.',
    steps: [
      'Add the TIFF the system refused.',
      'Convert. A palette is built from the colours present in the scan.',
      'Download and confirm the result is legible before relying on it.',
    ],
    faq: [
      {
        q: 'Is a scanned document damaged by the 256-colour limit?',
        a: 'Barely. A page of black text on white paper uses a handful of tones, so the palette is more than sufficient. It is photographs and continuous-tone artwork that suffer.',
      },
      {
        q: 'Will the GIF be smaller than the TIFF?',
        a: 'Usually much smaller, because the TIFF was uncompressed or lightly compressed and had no colour limit. This is one of the few cases where GIF compares well.',
      },
      {
        q: 'What about a multi-page TIFF?',
        a: 'Only the first page is converted. Pages after the first need to be split out beforehand.',
      },
      {
        q: 'Is there a better target?',
        a: 'PNG, wherever it is accepted — lossless, full colour, and supported almost as universally. Use GIF only when it is named specifically.',
      },
    ],
    note: 'Fax-compressed TIFFs — Group 3 and Group 4 — are one bit per pixel, so converting one to GIF changes the palette from two entries to two entries. In that specific case nothing at all is lost.',
  },
}
