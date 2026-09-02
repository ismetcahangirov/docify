/**
 * Copy for the five conversions that start from a GIF.
 *
 * The recurring question on every one of these pages is the animation, because
 * the answer — only the first frame survives — is the thing people are surprised
 * by. Each page says it once, in its own terms, rather than in a shared
 * sentence.
 */

import type { PairCopy } from './types'

export const GIF_COPY: Readonly<Record<string, PairCopy>> = {
  'gif-to-jpg': {
    h1: 'GIF to JPG, one frame out of an animation',
    intro:
      'Pulling a still out of a GIF is what this is for: a thumbnail for a video, a frame to annotate, an image for a document that will not accept an animation. JPEG is the target when the frame is photographic and the file needs to be small and universally readable.',
    steps: [
      'Add the GIF. Animated files are fine — the first frame is what is converted.',
      'Choose a quality. 85 is ample; a GIF has only 256 colours to begin with, so there is little detail for JPEG to lose.',
      'Download the JPG. It is ready the moment the job reports that it has finished.',
    ],
    faq: [
      {
        q: 'Which frame of the animation do I get?',
        a: 'The first. Extracting a specific later frame is a video operation rather than an image conversion.',
      },
      {
        q: 'Will the JPG be smaller than the GIF?',
        a: 'For a single frame, usually much smaller — a GIF carries the whole animation and the JPG carries one picture.',
      },
      {
        q: 'Why does the JPG look slightly blurry at the edges?',
        a: 'The GIF has hard-edged 256-colour regions and JPEG compresses in blocks, which softens exactly those transitions. Raise the quality, or use PNG if the image is a graphic rather than a photo.',
      },
      {
        q: 'What about the transparent areas?',
        a: 'They are filled with white, because JPEG has no transparency of any kind and every pixel must be given a value.',
      },
    ],
    note: 'A GIF frame is stored as palette indices, not colours, so converting to JPEG means expanding each index to a full RGB triple first. That expansion is why a flat GIF sometimes produces a JPEG larger than expected.',
  },

  'gif-to-png': {
    h1: 'GIF to PNG, the upgrade GIF was replaced by',
    intro:
      'PNG was designed in 1995 as a direct, patent-free replacement for GIF, and it is better at almost everything a single frame needs: more colours, real transparency, tighter compression. For any still image currently living in a GIF, this is the conversion that loses nothing and gains several things.',
    steps: [
      'Add the GIF — a logo, an icon, a diagram or a single frame from an animation.',
      'Convert. PNG is lossless, so there is nothing to set.',
      'Collect the PNG files from the results panel below, individually or all together.',
    ],
    faq: [
      {
        q: 'Is anything lost?',
        a: 'Nothing. PNG can represent every colour a GIF can, so the pixels are identical. The palette simply becomes an 8-bit indexed PNG or a full-colour one.',
      },
      {
        q: 'Does the transparency improve?',
        a: 'It becomes capable of improving. GIF stores one transparent index and PNG stores an alpha value per pixel, so edges that were hard in the GIF stay hard but can now be softened by an editor.',
      },
      {
        q: 'Will the PNG be smaller?',
        a: 'For most flat graphics, yes — PNG’s row prediction beats LZW. Some very small or very simple GIFs come out marginally larger.',
      },
      {
        q: 'What happens to an animation?',
        a: 'Only the first frame is written. Animated PNG exists, but almost nothing outside browsers reads it, so it is not the target here.',
      },
    ],
    note: 'PNG exists because Unisys began enforcing the LZW patent that GIF depends on, in 1994. The format was specified, implemented and published inside two years, which is why it looks so much more deliberate than the format it replaced.',
  },

  'gif-to-webp': {
    h1: 'GIF to WebP to make an old graphic web-sized again',
    intro:
      'GIFs that have been sitting on a site since the last redesign are usually several times larger than they need to be, because LZW compression is forty years old. WebP re-encodes the same frame with a modern codec, keeps the transparency, and typically lands at a fraction of the size.',
    steps: [
      'Add the GIFs currently on your site.',
      'Leave the quality high for flat graphics with text; lower it if the frame is photographic.',
      'Download the WebP and check that it opens where the original would not.',
    ],
    faq: [
      {
        q: 'How much smaller will it be?',
        a: 'For a flat graphic, lossless WebP is commonly half the size of the GIF. For a photographic frame, lossy WebP can be a tenth of it.',
      },
      {
        q: 'Does the animation come across?',
        a: 'No. Animated WebP exists and is well supported, but this conversion produces a still image from the first frame.',
      },
      {
        q: 'Will the 256-colour limitation disappear?',
        a: 'The limit is lifted, but the colours that were already discarded are not restored. A banded GIF stays banded.',
      },
      {
        q: 'Is transparency preserved?',
        a: 'Yes, and upgraded from a single transparent index to a full alpha channel.',
      },
    ],
    note: 'Animated GIF has no inter-frame compression worth the name — each frame is stored almost independently. That is why a five-second GIF can be twenty megabytes and the same clip as a video is under one.',
  },

  'gif-to-avif': {
    h1: 'GIF to AVIF, forty years of compression research in one step',
    intro:
      'This is the largest efficiency jump available between two image formats: LZW from 1984 replaced by AV1 from 2018. For a single frame the result is dramatically smaller, keeps transparency, and lifts the colour ceiling — at the cost of encoding time and slightly narrower support.',
    steps: [
      'Add the GIF you want re-encoded.',
      'Set a quality. AVIF is generous here; flat graphics stay clean well below 60.',
      'Wait for the encode to finish, then download.',
    ],
    faq: [
      {
        q: 'Why would I target AVIF rather than WebP?',
        a: 'Size, if you are serving the image at volume. WebP is easier and more widely supported; AVIF is smaller.',
      },
      {
        q: 'Does the animation survive?',
        a: 'No. AVIF sequences exist but browser support for them is thin, so this conversion writes a single frame.',
      },
      {
        q: 'Is a small GIF worth converting?',
        a: 'Often not. AVIF has fixed container overhead, and below a few kilobytes it can produce a larger file than the GIF it replaced.',
      },
      {
        q: 'What happens to transparency?',
        a: 'It is carried across and stored as a separate alpha plane, so it can be soft rather than binary from here on.',
      },
    ],
    note: 'The 256-colour palette a GIF carries is not a compression choice but a hard format limit written into the 1987 specification, back when a colour display commonly had four bits per pixel. Nothing since has had to work under it.',
  },

  'gif-to-tiff': {
    h1: 'GIF to TIFF for archives that will not take a web format',
    intro:
      'Institutional archives and document systems specify TIFF, and a GIF submitted to one comes straight back. The conversion is lossless in both directions — a GIF frame is a bitmap and TIFF stores bitmaps — so this is a container change dressed as a format conversion.',
    steps: [
      'Add the GIFs the archive rejected.',
      'Convert. Nothing is discarded; there is nothing to configure.',
      'Save the TIFF result, and delete the original afterwards if you no longer need it.',
    ],
    faq: [
      {
        q: 'Is any colour information lost?',
        a: 'None. The GIF has at most 256 colours and TIFF can store millions, so every pixel is represented exactly.',
      },
      {
        q: 'Will the TIFF be bigger?',
        a: 'Usually, sometimes substantially. TIFF’s compression is not tuned for indexed graphics the way GIF’s LZW is.',
      },
      {
        q: 'Does the transparent index survive?',
        a: 'It becomes an alpha channel where the TIFF is written with one, but many archival systems flatten on import. Ask what background they expect.',
      },
      {
        q: 'Can the animation become a multi-page TIFF?',
        a: 'The format could hold it, but this conversion writes the first frame only. Multi-page TIFF is a scanning convention, not an animation one.',
      },
    ],
    note: 'Both TIFF and GIF can use LZW compression — TIFF adopted it in 1992, five years after GIF — and both were caught by the same Unisys patent. TIFF survived it because it had four other compression schemes to fall back on.',
  },
}
