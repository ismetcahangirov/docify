/**
 * Copy for the six conversions that start from a WebP.
 *
 * Almost everyone converting *out of* WebP is doing it under protest: they
 * saved an image from a website and something downstream will not open it. The
 * pages here lead with that, rather than with an argument about codecs the
 * reader did not come for.
 */

import type { PairCopy } from './types'

export const WEBP_COPY: Readonly<Record<string, PairCopy>> = {
  'webp-to-jpg': {
    h1: 'WebP to JPG, because you saved an image and nothing will open it',
    intro:
      'Saving a picture from a website increasingly hands you a `.webp`, and then Photoshop, Word, a print shop or a phone gallery refuses it. JPG is the way out: the same picture, in the one image format that has never needed explaining to anything.',
    steps: [
      'Drop in the WebP files you downloaded.',
      'Pick a quality. 90 keeps the conversion visually free; 80 halves the file again if size matters more.',
      'Download the JPGs and carry on with whatever refused the WebP.',
    ],
    faq: [
      {
        q: 'Am I losing quality by converting?',
        a: 'A little, because both formats are lossy and this is a second encode. At quality 90 the difference is not visible on a photograph; at 70 it starts to be.',
      },
      {
        q: 'The WebP had a transparent background. What now?',
        a: 'JPEG cannot store transparency, so those areas become white. Convert to PNG instead if the cut-out matters.',
      },
      {
        q: 'Why do websites serve WebP at all?',
        a: 'Because it is roughly a third smaller than JPEG for the same visible quality, which is a large saving on a page full of photographs. The cost lands on whoever downloads one.',
      },
      {
        q: 'Will the JPG be bigger than the WebP?',
        a: 'Usually, by thirty to fifty percent. That is the same efficiency gap running in the other direction.',
      },
    ],
    note: 'A WebP saved from a website is often already a re-encode of a JPEG the site was given. Converting it back to JPG is therefore a third generation, which is why the quality setting is worth raising rather than leaving at a default.',
  },

  'webp-to-png': {
    h1: 'WebP to PNG when the transparency has to survive the trip',
    intro:
      'Logos, icons and cut-out product shots are increasingly served as WebP, and a lot of design and office software still will not take one. PNG is the target that keeps the alpha channel intact, so the graphic still sits cleanly on whatever background you put it against.',
    steps: [
      'Add the WebP graphics you need in a more portable format.',
      'Convert. Nothing is configurable, because PNG discards nothing.',
      'Save the PNG results. Each has its own link, and a batch has one archive as well.',
    ],
    faq: [
      {
        q: 'Does the transparency really come through?',
        a: 'Yes, at full 8-bit precision. Both formats store alpha per pixel rather than as a single transparent colour, so soft edges and drop shadows survive intact.',
      },
      {
        q: 'Is the PNG lossless compared with the WebP?',
        a: 'Lossless from this point forward. If the WebP was saved in lossy mode, the compression it already applied is baked in and cannot be recovered.',
      },
      {
        q: 'Why is the PNG so much larger?',
        a: 'Lossless PNG against lossy WebP is not a fair fight — the WebP threw information away and the PNG cannot. On a graphic saved as lossless WebP the gap is closer to thirty percent.',
      },
      {
        q: 'Which should I keep for a website?',
        a: 'The WebP, if the browsers you care about support it. PNG is the compatibility copy, not the one to serve.',
      },
    ],
    note: 'WebP’s lossless mode uses a completely different design from its lossy mode — colour transforms and a custom entropy coder rather than VP8 prediction. A “lossless WebP” and a “lossy WebP” share only a file extension.',
  },

  'webp-to-avif': {
    h1: 'WebP to AVIF, one modern format for a slightly newer one',
    intro:
      'Both were designed to replace JPEG, five years apart, and AVIF generally wins on size by a further twenty to thirty percent. The reason to move is a large image library where bandwidth is the bill. For a handful of files the encoding time will cost you more than the bytes save.',
    steps: [
      'Add the WebP images you are re-encoding.',
      'Pick a quality — AVIF stays clean at settings well below what WebP tolerates.',
      'Let each file finish encoding, then download the batch.',
    ],
    faq: [
      {
        q: 'Is it worth re-encoding an existing WebP library?',
        a: 'Only at scale. You are adding a third lossy generation for a twenty to thirty percent saving, which pays off on millions of image requests and not on a personal site.',
      },
      {
        q: 'Does AVIF have broader support than WebP now?',
        a: 'Not yet. WebP is supported slightly more widely, particularly on older Android and in email clients. AVIF’s advantage is size, not reach.',
      },
      {
        q: 'Will transparency survive?',
        a: 'Yes. Both formats carry a full alpha channel, and it is preserved through the conversion.',
      },
      {
        q: 'Why is AVIF encoding so much slower?',
        a: 'AV1 searches many more prediction modes per block than VP8 does. That search is the compression; skipping it would mean giving the saving back.',
      },
    ],
    note: 'WebP is capped at 16,383 pixels on each side, a limit inherited from VP8’s frame header. AVIF has no comparable ceiling, which makes this conversion the practical route for very large panoramic images.',
  },

  'webp-to-gif': {
    h1: 'WebP to GIF for a chat window that will not take anything else',
    intro:
      'Animated WebP is common on the web and unsupported almost everywhere else — messaging apps, forums and older clients want GIF. This conversion produces the still frame in a format those systems accept, at the cost of everything above 256 colours.',
    steps: [
      'Add the WebP files, a whole folder at once if you like; nothing leaves your device.',
      'Convert. A palette is derived from the colours the image actually contains.',
      'Download and check for banding before posting it anywhere.',
    ],
    faq: [
      {
        q: 'Will an animated WebP stay animated?',
        a: 'No. This conversion produces a single still image. Animation between the two formats needs a video pipeline rather than an image one.',
      },
      {
        q: 'Why does the result look posterised?',
        a: 'GIF holds 256 colours per frame and a photographic image has far more. The encoder approximates the rest, which is visible first in skies and skin.',
      },
      {
        q: 'Is GIF smaller than WebP?',
        a: 'Almost never — GIF is a 1987 format with 1980s compression, and WebP will beat it even at full colour.',
      },
      {
        q: 'Is there a better target?',
        a: 'PNG, wherever it is accepted. GIF is worth choosing only when a system names it explicitly.',
      },
    ],
    note: 'Animated WebP and GIF store motion in a similar way — a sequence of frames with disposal rules — but WebP can use lossy inter-frame prediction, which is why an animated WebP is routinely a tenth the size of the GIF it replaced.',
  },

  'webp-to-tiff': {
    h1: 'WebP to TIFF for print and archival systems, unchanged',
    intro:
      'A print bureau, a document management system or an institutional archive will not accept a web format, and asking them to is a longer conversation than converting the file. TIFF is what they specified; this produces it losslessly from whatever the WebP decoded to.',
    steps: [
      'Add the WebP files the archive or printer rejected.',
      'Convert. Nothing is configurable and nothing is discarded.',
      'Download. The TIFFs will be considerably larger than the WebPs.',
    ],
    faq: [
      {
        q: 'Does this improve the image for print?',
        a: 'No. Whatever the WebP’s lossy compression removed is gone. The gain is acceptance, plus the guarantee that nothing further is lost in the workflow.',
      },
      {
        q: 'Is the colour profile carried over?',
        a: 'Yes, where the WebP has one. Print workflows depend on profiles, so this is the part worth checking before sending a job.',
      },
      {
        q: 'Does transparency survive?',
        a: 'TIFF can carry an alpha channel and it is written here, though many print tools will flatten it on import. Composite it yourself if the background matters.',
      },
      {
        q: 'How big will the TIFF be?',
        a: 'Roughly the uncompressed size of the image, reduced a little by lossless compression — typically ten to thirty times the WebP.',
      },
    ],
    note: 'TIFF predates WebP by twenty-four years and still holds features WebP has never had: CMYK colour, multiple pages, and arbitrary tagged metadata. That gap is exactly why prepress never left it.',
  },

  'webp-to-bmp': {
    h1: 'WebP to BMP for tools that read pixels straight off disk',
    intro:
      'Machine vision software, embedded firmware and older Windows utilities frequently accept BMP alone, because it needs no decoder at all — the pixels sit in the file in order. If a device has rejected your WebP without explaining why, this is usually the format it wanted.',
    steps: [
      'Add the WebP file the device or tool refused.',
      'Convert. There is nothing to configure, because the target format has no settings to weigh up.',
      'Download. The result is uncompressed, so plan for three bytes per pixel.',
    ],
    faq: [
      {
        q: 'Why does anything still require BMP?',
        a: 'Because reading it requires no library. Firmware with a few kilobytes of memory can display a BMP by copying bytes; anything else needs a decoder it has no room for.',
      },
      {
        q: 'Is quality lost?',
        a: 'Not in this step — the decoded pixels are written exactly. The WebP’s own lossy compression is already part of the image and stays.',
      },
      {
        q: 'What happens to transparency?',
        a: 'It is unreliable. BMP’s 32-bit form has an alpha channel that many readers ignore, so treat transparent regions as undefined and composite them yourself if it matters.',
      },
      {
        q: 'Will the BMP be very large?',
        a: 'Yes. Width times height times three bytes, regardless of the content. A 4000 by 3000 image is about 36 MB.',
      },
    ],
    note: 'BMP’s header carries a horizontal and vertical resolution field measured in pixels per metre, which almost nothing writes correctly and almost nothing reads. Print software that scales a BMP oddly is usually trusting that field.',
  },
}
