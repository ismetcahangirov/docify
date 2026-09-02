/**
 * Copy for the five conversions that start from an AVIF.
 *
 * AVIF is new enough that almost nobody has one on purpose — it arrived as a
 * download from a site that serves them. These pages are written for somebody
 * who has been handed a file their software has never heard of.
 */

import type { PairCopy } from './types'

export const AVIF_COPY: Readonly<Record<string, PairCopy>> = {
  'avif-to-jpg': {
    h1: 'AVIF to JPG for software that has never heard of AV1',
    intro:
      'AVIF is the newest image format a browser will display, which means anything older than a browser will not touch it — office suites, print shops, photo frames, phone galleries. Converting to JPG turns a file almost nothing opens into a file nothing has ever refused.',
    steps: [
      'Add the AVIF files you downloaded or were sent.',
      'Set a quality. 90 keeps the conversion invisible; the AVIF was already small, so a high setting costs you little.',
      'Download the finished JPG and carry on with whatever needed it in the first place.',
    ],
    faq: [
      {
        q: 'Why did I end up with an AVIF at all?',
        a: 'A growing number of sites serve AVIF to browsers that advertise support, and “save image as” gives you exactly what was sent. The file is not corrupt; it is simply five years ahead of most desktop software.',
      },
      {
        q: 'Will the JPG be bigger?',
        a: 'Considerably — often two to three times. AVIF is the most efficient still format in common use, and JPEG is the least.',
      },
      {
        q: 'Is quality lost in the conversion?',
        a: 'Some, since both formats are lossy and this is a second encode. Using quality 90 or above makes it very hard to see on anything photographic.',
      },
      {
        q: 'What about transparency and HDR?',
        a: 'Both are lost. JPEG has no alpha channel and no high-dynamic-range mode, so transparent areas become white and HDR is tone-mapped down to standard range.',
      },
    ],
    note: 'AVIF is a single AV1 video frame in a HEIF container. That is why decoders arrived so quickly in browsers — they already shipped an AV1 decoder for video — and so slowly everywhere else, where no such decoder existed.',
  },

  'avif-to-png': {
    h1: 'AVIF to PNG, keeping transparency an editor can actually use',
    intro:
      'When the AVIF you have is a graphic rather than a photograph, its alpha channel is usually the point of it. PNG is the target that keeps that channel intact while being readable by every editor, office suite and operating system preview written in the last twenty years.',
    steps: [
      'Drop the AVIF files onto the page, or reach for the file picker if you prefer.',
      'Convert. PNG has no quality setting; it stores what it is given.',
      'Take the PNG output from the results panel once the queue has finished working.',
    ],
    faq: [
      {
        q: 'Does the alpha channel survive?',
        a: 'Yes, at full precision. AVIF stores alpha as a separate plane and PNG stores it per pixel, and the conversion between the two is exact.',
      },
      {
        q: 'What happens to a 10-bit AVIF?',
        a: 'It is reduced to 8 bits per channel, which is what PNG is written at here. On photographic content that is invisible; on a synthetic gradient it can introduce faint banding.',
      },
      {
        q: 'Why is the PNG so much larger?',
        a: 'You are trading a lossy modern codec for a lossless one from 1996. Ten to thirty times is normal for photographic content and far less for flat graphics.',
      },
      {
        q: 'Is PNG the right choice for the web?',
        a: 'Only for graphics with hard edges. If the AVIF was a photograph and you need broad support, JPG or WebP will be a fraction of the size.',
      },
    ],
    note: 'AVIF can store an image at 8, 10 or 12 bits per channel. PNG supports 8 and 16 and nothing between, so a 10-bit source has to be rounded in one direction or padded in the other — this conversion rounds down to 8.',
  },

  'avif-to-webp': {
    h1: 'AVIF to WebP for the widest support a modern format can get',
    intro:
      'If AVIF is too new for the software you are handing the file to, WebP is the next step back rather than a full retreat to JPEG. It keeps transparency, keeps most of the size advantage, and has been supported by every major browser and most image tools since 2020.',
    steps: [
      'Choose the AVIF files you want converted; several at a time is no problem at all.',
      'Choose a quality — 80 is the usual setting for a straight re-encode.',
      'Download. WebP will be larger than the AVIF and smaller than a JPEG.',
    ],
    faq: [
      {
        q: 'How much bigger will the WebP be?',
        a: 'Typically twenty to forty percent larger than the AVIF at matched quality, and still around thirty percent smaller than the JPEG equivalent.',
      },
      {
        q: 'Which is better supported?',
        a: 'WebP, by a margin that is shrinking. Older Android versions, several email clients and a lot of desktop software read WebP and not AVIF.',
      },
      {
        q: 'Does transparency come across?',
        a: 'Yes. Both formats carry a proper alpha channel, so nothing is flattened.',
      },
      {
        q: 'Is this conversion lossy?',
        a: 'Yes — a decode and a re-encode. At quality 80 or above the second generation is not usually visible, but it is real.',
      },
    ],
    note: 'Both formats descend from video codecs, one generation apart: WebP from VP8 and AVIF from AV1. The size difference between them is essentially the difference between 2008 and 2018 in video compression research.',
  },

  'avif-to-gif': {
    h1: 'AVIF to GIF, dragging a 2019 format back to 1987',
    intro:
      'There is one situation where this makes sense: something old and immovable accepts GIF and nothing else. Everything about the conversion is a downgrade — 256 colours, no partial transparency, worse compression — and it is worth doing only when the receiving system has left no other option.',
    steps: [
      'Put the AVIF files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. The palette is built from the colours actually present in the image.',
      'Download and inspect it before relying on it.',
    ],
    faq: [
      {
        q: 'Why is the GIF larger than the AVIF?',
        a: 'GIF uses LZW compression from the 1980s and AVIF uses AV1. Even with a fraction of the colours to store, GIF loses by a wide margin.',
      },
      {
        q: 'What happens to the transparency?',
        a: 'It becomes on-or-off. GIF marks one palette entry transparent, so anti-aliased edges harden and soft shadows disappear.',
      },
      {
        q: 'Will an animated AVIF stay animated?',
        a: 'No. AVIF sequences exist, but this conversion writes a single still frame — the first one in the file.',
      },
      {
        q: 'Is there anything better to try first?',
        a: 'PNG. It is lossless, it handles full colour and real transparency, and it is accepted almost everywhere GIF is.',
      },
    ],
    note: 'GIF and AVIF sit at opposite ends of the same problem. GIF solved “images on a 1987 modem” with a palette and LZW; AVIF solved “images on a 2019 network” with motion-compensated prediction. Nothing in either design has anything in common with the other.',
  },

  'avif-to-tiff': {
    h1: 'AVIF to TIFF for a print workflow that stops at 2001',
    intro:
      'Prepress and archival systems accept TIFF and treat anything else as a mistake. AVIF is thirty-five years newer than the format they specified, so the conversion is not really about images at all — it is about getting the file through a door that only opens one way.',
    steps: [
      'Add the AVIF files the printer or archive turned down.',
      'Convert. TIFF is written losslessly, so nothing further is given up.',
      'Download. Expect files ten to fifty times larger than the AVIF.',
    ],
    faq: [
      {
        q: 'Does the print quality improve?',
        a: 'No. TIFF preserves what it is handed, and what it is handed is a decoded AVIF including whatever its compression removed. What you gain is acceptance.',
      },
      {
        q: 'What about 10-bit colour?',
        a: 'TIFF supports 16 bits per channel, so a 10-bit AVIF can be carried without truncation. Check with the print bureau, since some of their tools expect 8-bit.',
      },
      {
        q: 'Is the colour profile preserved?',
        a: 'Yes, and it matters more here than in most conversions — a wide-gamut AVIF interpreted as sRGB by a printer will come out visibly wrong.',
      },
      {
        q: 'Does transparency carry over?',
        a: 'TIFF can hold an alpha channel and it is written, but most print workflows flatten it. Composite it against the intended background before sending.',
      },
    ],
    note: 'TIFF’s specification has been frozen since 1992 and its extension mechanism means new capabilities arrive as private tags nobody else reads. That stability is why archives chose it, and why it will still be the requested format long after AVIF is old.',
  },
}
