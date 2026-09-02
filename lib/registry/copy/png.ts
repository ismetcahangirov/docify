/**
 * Copy for the seven conversions that start from a PNG.
 *
 * A PNG arrives for one of two reasons — it is a screenshot, or it is a graphic
 * with a transparent background — and those two histories want different
 * things. Every page below picks the one that matters for its target rather
 * than repeating both.
 */

import type { PairCopy } from './types'

export const PNG_COPY: Readonly<Record<string, PairCopy>> = {
  'png-to-jpg': {
    h1: 'PNG to JPG to stop a screenshot weighing five megabytes',
    intro:
      'Screenshots and exported graphics arrive as PNG, and a full-screen capture on a modern display can run to several megabytes. Attachment limits and upload forms object. JPEG turns the same picture into a few hundred kilobytes, at the cost of transparency and a little sharpness on hard edges.',
    steps: [
      'Add the PNGs that are too heavy to send.',
      'Choose a quality. 85 keeps text readable; drop to 70 only for photographic content with no lettering in it.',
      'Download the JPGs, or take the batch as a single ZIP.',
    ],
    faq: [
      {
        q: 'What happens to the transparent parts?',
        a: 'JPEG has no alpha channel, so transparency is filled with white. If your graphic was designed to sit on a coloured background, that fill will be visible as a white rectangle around it.',
      },
      {
        q: 'Why does the text in my screenshot look fuzzy?',
        a: 'JPEG compresses in eight-by-eight blocks and struggles with the hard black-on-white transitions that letterforms are made of. Raise the quality to 90 or above, or keep screenshots as PNG and use WebP if size is the problem.',
      },
      {
        q: 'How much smaller will the file be?',
        a: 'For a screenshot, typically five to twenty times. For a photograph already saved as PNG, often fifty times or more — PNG is a poor fit for photographs to begin with.',
      },
      {
        q: 'Can I get the PNG back afterwards?',
        a: 'You can convert back, but the detail JPEG discarded does not return and the transparency is permanently gone. Keep the PNG if it is your only copy.',
      },
    ],
    note: 'PNG compresses by predicting each pixel from the ones above and to the left, which is why it is so effective on the flat panels and repeated pixel rows of an interface, and so nearly useless on camera noise.',
  },

  'png-to-webp': {
    h1: 'PNG to WebP, keeping the transparency and dropping the weight',
    intro:
      'WebP is the only widely-supported format that does what PNG does — an alpha channel, sharp edges, lossless mode — and does it in a substantially smaller file. For interface graphics, logos and screenshots on a website it is close to a free upgrade, with none of JPEG’s white-background problem.',
    steps: [
      'Drop in the PNGs your site currently serves.',
      'Choose a quality if the image is photographic, or leave it high for graphics with text and hard edges.',
      'Download and swap them in. Transparency survives either way.',
    ],
    faq: [
      {
        q: 'Does transparency really survive?',
        a: 'Yes. WebP carries a full 8-bit alpha channel in both its lossy and lossless modes, so a cut-out logo stays cut out.',
      },
      {
        q: 'How much smaller is a WebP than a PNG?',
        a: 'Lossless WebP is typically twenty to thirty percent smaller than the equivalent PNG. Lossy WebP with alpha can be several times smaller again, if the graphic tolerates it.',
      },
      {
        q: 'Will it look identical?',
        a: 'In lossless mode, pixel for pixel. In lossy mode, hard edges soften slightly — which matters for a screenshot with small text and not at all for a photograph.',
      },
      {
        q: 'Is WebP supported in email?',
        a: 'Patchily. Web browsers are fine; several desktop email clients still are not, so keep PNG for anything embedded in a newsletter.',
      },
    ],
    note: 'WebP is really two formats sharing an extension: a lossy one built on VP8 keyframes and a lossless one with an entirely separate design. An encoder picks between them from the quality setting, which is why a WebP can be either a smaller JPEG or a smaller PNG.',
  },

  'png-to-avif': {
    h1: 'PNG to AVIF for graphics that must be small and still transparent',
    intro:
      'AVIF holds an alpha channel like PNG and compresses like a modern video codec, which is a combination nothing else offers. For illustrations and interface art on a high-traffic page the saving over PNG is large. Encoding is slow enough that it belongs in a build step rather than a workflow you repeat by hand.',
    steps: [
      'Add the PNGs — illustrations and flat graphics benefit most.',
      'Set a quality. Graphics tolerate lower numbers than photographs before edges start to soften.',
      'Wait for the encode, then download. This is the slowest conversion on the site.',
    ],
    faq: [
      {
        q: 'Does AVIF keep the alpha channel?',
        a: 'Yes, and it encodes it as a separate monochrome plane, so a soft shadow or an anti-aliased edge survives properly rather than being reduced to on-or-off.',
      },
      {
        q: 'Is AVIF lossless for flat graphics?',
        a: 'It has a lossless mode, but it is rarely competitive with lossless WebP on flat colour. AVIF earns its keep on photographic and gradient content.',
      },
      {
        q: 'Why did a simple icon get bigger?',
        a: 'Small images with very few colours are the one case where AVIF loses. Its container overhead is fixed, and a 64-pixel icon has almost nothing for the codec to compress. Keep those as PNG or SVG.',
      },
      {
        q: 'Can I use AVIF as a favicon?',
        a: 'No. Browsers expect ICO, PNG or SVG for favicons, and none of them will fetch an AVIF for that slot.',
      },
    ],
    note: 'AVIF stores its alpha channel as a completely separate AV1 image inside the same container. That is why transparency costs so little here and why some older decoders show an AVIF as fully opaque — they read the colour plane and ignore the second one.',
  },

  'png-to-gif': {
    h1: 'PNG to GIF for a 256-colour world you did not choose',
    intro:
      'Flat graphics survive this conversion far better than photographs do: a logo with eight colours fits inside a 256-colour palette with room to spare. This is the case where GIF is a reasonable target rather than a compromise, and where the on-or-off transparency it offers is usually enough.',
    steps: [
      'Add the PNG — a logo, an icon or a diagram, ideally with a limited palette.',
      'Convert. The palette is built from the colours actually present, so a simple graphic keeps them all.',
      'Download and check the edges where the image used to fade out.',
    ],
    faq: [
      {
        q: 'What happens to my soft transparent edges?',
        a: 'They harden. GIF transparency is a single index rather than a channel, so a pixel is fully visible or fully absent. Anti-aliased edges become jagged against any background other than the one they were designed on.',
      },
      {
        q: 'Will a simple logo lose colours?',
        a: 'Not if it has fewer than 256 of them, which most vector-derived graphics do. The loss only bites on gradients and photographs.',
      },
      {
        q: 'Is GIF smaller than PNG here?',
        a: 'Occasionally, for very simple images. PNG usually wins, because its per-row prediction beats LZW on the flat runs both formats are good at.',
      },
      {
        q: 'Why would anyone still target GIF?',
        a: 'Because a specific system asks for it — some ticketing tools, forum uploaders and embedded displays list GIF and nothing newer.',
      },
    ],
    note: 'GIF’s single transparent palette index is the reason web graphics from the 1990s have that halo of grey pixels around them: they were anti-aliased against a background colour and then shown against a different one.',
  },

  'png-to-tiff': {
    h1: 'PNG to TIFF for document systems that were built before PNG',
    intro:
      'A great deal of scanning, archival and prepress software was specified when TIFF was the only serious lossless option, and never changed. Converting a PNG to TIFF loses nothing — both are lossless — and gets the file through a door that PNG cannot open.',
    steps: [
      'Add the PNGs the archive or print workflow has refused.',
      'Convert. Nothing is discarded in either direction; this is a container change.',
      'Download and hand the TIFFs over.',
    ],
    faq: [
      {
        q: 'Is any quality lost?',
        a: 'None. PNG and TIFF are both lossless, so the pixels arriving are the pixels leaving. Only the file size changes.',
      },
      {
        q: 'Does my transparency survive?',
        a: 'TIFF can hold an alpha channel and it is preserved here, but support among consumer TIFF readers is uneven. If the destination is a printer, flatten the image first.',
      },
      {
        q: 'Will the TIFF be bigger?',
        a: 'Usually somewhat, because PNG’s row filters are better tuned for screen graphics than TIFF’s deflate compression is.',
      },
      {
        q: 'Can I make a multi-page TIFF from several PNGs?',
        a: 'Not with this conversion — each PNG becomes its own TIFF. For a multi-page document, PDF is the more widely accepted answer.',
      },
    ],
    note: 'Both formats use the same deflate algorithm underneath. PNG applies a per-row prediction filter before deflating and TIFF generally does not, which is why the same picture is often a smaller PNG than TIFF.',
  },

  'png-to-bmp': {
    h1: 'PNG to BMP for software that wants raw pixels and nothing else',
    intro:
      'Some machine vision libraries, embedded displays and older Windows applications read BMP directly out of a buffer and have no decoder for anything else. Converting a PNG gives them exactly what they expect: a header, then every pixel in order, with no compression to unpack.',
    steps: [
      'Add the PNG the tool or device has rejected.',
      'Convert. BMP exposes no settings — there is nothing about it to configure.',
      'Download the file, which will be roughly three bytes per pixel.',
    ],
    faq: [
      {
        q: 'Is the image identical?',
        a: 'Yes for the colour channels — both formats are lossless. What may not survive is the transparency, since many BMP readers ignore the alpha channel even when it is present.',
      },
      {
        q: 'Why is it so much bigger?',
        a: 'BMP stores every pixel literally. A 4K screenshot that compressed to 2 MB as a PNG becomes about 24 MB as a BMP, and stays that size however plain the picture is.',
      },
      {
        q: 'Which BMP variant is written?',
        a: 'A standard uncompressed Windows bitmap, which is the one every reader handles. Exotic variants exist and are exactly what fails on old software.',
      },
      {
        q: 'Can I use BMP on the web?',
        a: 'Browsers will display it, but you should not. There is no reason to send an uncompressed bitmap over a network when PNG and WebP exist.',
      },
    ],
    note: 'BMP has no concept of a colour profile, so a file exported from a wide-gamut PNG will be interpreted as sRGB by whatever opens it. On saturated graphics that shows up as a visible shift.',
  },

  'png-to-pdf': {
    h1: 'PNG to PDF, turning screenshots into a document somebody will read',
    intro:
      'A bug report, a set of screenshots for a manual, or a sequence of diagrams is easier to send as one document than as eleven separate images. Each PNG becomes a page, in the order you arrange them, in a file that opens identically on every machine that receives it.',
    steps: [
      'Add the PNGs in the order they should appear.',
      'Convert. One image becomes one page, sized to the image rather than forced onto A4.',
      'Download the PDF files one at a time, or take the whole batch as a single archive.',
    ],
    faq: [
      {
        q: 'Are the screenshots still sharp in the PDF?',
        a: 'Yes. The images are embedded at their full resolution, so zooming into the document shows exactly what the PNG contained.',
      },
      {
        q: 'What happens to transparency?',
        a: 'Transparent areas are composited onto white, because a printed page has no notion of “see-through”. Add your own background first if white is wrong.',
      },
      {
        q: 'How large will the PDF be?',
        a: 'Roughly the sum of the images. PNGs are large, so a twenty-screenshot document can easily run to tens of megabytes — converting the screenshots to JPG first is the usual fix.',
      },
      {
        q: 'Can I reorder the pages?',
        a: 'Yes, before converting: the page order follows the order of the files in the queue, and the queue can be rearranged.',
      },
    ],
    note: 'PDF cannot embed a PNG stream directly the way it embeds a JPEG. The image is decoded and re-stored as a Flate-compressed bitmap, which is why a PNG-heavy document is usually larger than the pictures that went into it.',
  },
}
