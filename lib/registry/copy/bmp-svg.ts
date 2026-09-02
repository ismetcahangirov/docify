/**
 * Copy for the seven conversions that start from a BMP or an SVG.
 *
 * Two small source formats in one file, because neither has enough targets to
 * justify its own and the two are opposites worth reading together: BMP is
 * pixels with nothing around them, SVG is instructions with no pixels at all.
 */

import type { PairCopy } from './types'

export const BMP_SVG_COPY: Readonly<Record<string, PairCopy>> = {
  'bmp-to-jpg': {
    h1: 'BMP to JPG, twenty megabytes down to two hundred kilobytes',
    intro:
      'A BMP stores every pixel literally, so even a modest image runs to tens of megabytes and cannot be emailed, uploaded or posted anywhere. JPEG compresses the same picture to a small fraction of that, which is usually the entire reason anybody opens a BMP in the first place.',
    steps: [
      'Add the BMP files, whatever size they are.',
      'Set a quality — 85 is the usual choice for photographic content.',
      'Download. The saving is typically fifty to a hundred times.',
    ],
    faq: [
      {
        q: 'Why is my BMP so large?',
        a: 'It is not compressed at all. The file is a header followed by three bytes per pixel, so its size depends only on the dimensions and never on the content.',
      },
      {
        q: 'Is quality lost?',
        a: 'Some, since JPEG is lossy. A BMP is generally a first-generation image, so this is the first compression it has been through and the result at quality 85 is very close to the original.',
      },
      {
        q: 'Where do BMP files come from these days?',
        a: 'Screen capture utilities, laboratory and industrial cameras, medical imaging exports, and old Windows software that never gained another export option.',
      },
      {
        q: 'Does the BMP have transparency to lose?',
        a: 'Rarely. The 32-bit variant has an alpha channel but most producers write 24-bit opaque BMPs, in which case there is nothing to lose.',
      },
    ],
    note: 'BMP rows are padded to a multiple of four bytes, so a 999-pixel-wide 24-bit image carries three wasted bytes on every row. It is a small thing that adds up to megabytes on a large capture.',
  },

  'bmp-to-png': {
    h1: 'BMP to PNG, the same pixels in a tenth of the space',
    intro:
      'Both formats are lossless, so this conversion changes nothing about the image and everything about the file. PNG compresses what BMP stores raw — often by a factor of ten on screen captures and interface graphics — while being readable by every browser and editor in existence.',
    steps: [
      'Add the BMP file you need converted, and wait for it to appear in the list.',
      'Convert. Both formats are lossless; there is nothing to set and nothing to lose.',
      'Download the PNG files one at a time, or take the whole batch as a single archive.',
    ],
    faq: [
      {
        q: 'Is the image bit-for-bit identical?',
        a: 'Yes for the colour data. PNG is lossless, so decoding the result gives back exactly the pixels the BMP held.',
      },
      {
        q: 'How much smaller will it be?',
        a: 'Five to twenty times for screenshots and interface graphics, and two to four times for photographic content, where there is less repetition to exploit.',
      },
      {
        q: 'Should I always prefer PNG to BMP?',
        a: 'Unless something specifically requires a BMP, yes. PNG is smaller, lossless, supports transparency and is universally readable.',
      },
      {
        q: 'Does a 32-bit BMP keep its alpha?',
        a: 'Where the source genuinely carries one, it is preserved. Many 32-bit BMPs have a meaningless fourth byte, in which case the result is fully opaque.',
      },
    ],
    note: 'PNG’s advantage on a BMP comes almost entirely from its row filters — each row is predicted from the one above before compression. On a screenshot, where rows repeat exactly, that turns thousands of identical pixels into almost nothing.',
  },

  'bmp-to-webp': {
    h1: 'BMP to WebP for the smallest file a browser will still open',
    intro:
      'If a BMP needs to go on a website or into a modern application, WebP is the target that shrinks it hardest while staying universally displayable. Lossless mode keeps a screen capture exact; lossy mode takes a photographic BMP down to a percent or two of its original size.',
    steps: [
      'Drop in the BMP files. They stay on this device from the first byte to the last.',
      'Choose a quality — high for captures with text, lower for photographs.',
      'Save the WebP results. Each has its own link, and a batch has one archive as well.',
    ],
    faq: [
      {
        q: 'Lossless or lossy for a screenshot?',
        a: 'Lossless. Screen captures are flat colour and sharp text, which lossless WebP compresses extremely well and lossy WebP softens.',
      },
      {
        q: 'How does this compare with converting to PNG?',
        a: 'Lossless WebP is typically twenty to thirty percent smaller than the equivalent PNG, with the same guarantee that no pixel changed.',
      },
      {
        q: 'Are there size limits?',
        a: 'Yes — 16,383 pixels on either side. Very large industrial captures can exceed that and need AVIF or a downscale.',
      },
      {
        q: 'Will old software open the WebP?',
        a: 'Browsers since 2020 will. Desktop applications are more mixed, so keep PNG if the file has to survive being opened by something ancient.',
      },
    ],
    note: 'A BMP has no colour profile field at all, so its pixels are interpreted as sRGB by whatever reads them. That assumption is carried into the WebP, which is correct almost always and wrong for a wide-gamut instrument capture.',
  },

  'svg-to-png': {
    h1: 'SVG to PNG, turning drawing instructions into actual pixels',
    intro:
      'An SVG is a set of shapes, not an image, which is why it scales perfectly and why so much software will not touch it. Rasterising to PNG produces a real bitmap at a real size — with transparency intact — that any editor, document, slide deck or upload form will accept.',
    steps: [
      'Select the SVG files, either by dropping them here or by pasting from the clipboard.',
      'Set the output width or height. This is the one decision that matters: an SVG has no inherent resolution, so you are choosing one.',
      'Download the PNGs, transparency and all.',
    ],
    faq: [
      {
        q: 'What size should I export at?',
        a: 'At least twice the size it will be displayed at, so it stays sharp on a high-density screen. For a logo on a web page, 2x the CSS width is the usual rule.',
      },
      {
        q: 'Does the transparent background survive?',
        a: 'Yes. Anything the SVG did not paint becomes transparent in the PNG, so the graphic still sits cleanly on any background.',
      },
      {
        q: 'Why do my fonts look wrong?',
        a: 'An SVG that references a font by name relies on that font being installed. Convert text to outlines in your drawing tool before exporting, and the shapes travel with the file.',
      },
      {
        q: 'Are external images inside the SVG included?',
        a: 'Only if they are embedded as data. An SVG that links to a remote image will render without it, since nothing here fetches anything from the network.',
      },
    ],
    note: 'SVG is XML, so an SVG file is a document that happens to describe a picture — which is why it can be edited in a text editor, searched, and diffed in version control, and why a raster export is a one-way door.',
  },

  'svg-to-jpg': {
    h1: 'SVG to JPG when the destination refuses anything with transparency',
    intro:
      'Print shops, some social platforms and a lot of older document software want a flat, opaque JPEG. Rasterising an SVG straight to JPG gets there in one step, at a resolution you choose, with the transparent regions composited onto a solid background rather than arriving as unexpected black.',
    steps: [
      'Add the SVG files you want changed. The queue will take as many as you have.',
      'Choose an output size — this is what fixes the resolution, since the SVG itself has none.',
      'Set a quality and download. Transparent areas are filled with white.',
    ],
    faq: [
      {
        q: 'What colour do transparent areas become?',
        a: 'White. JPEG cannot represent transparency at all, so every pixel must be given a value, and white is what a printed page expects.',
      },
      {
        q: 'Should I use JPG or PNG for a logo?',
        a: 'PNG, unless the destination insists on JPG. A logo is flat colour and hard edges, which JPEG compresses badly and PNG compresses well.',
      },
      {
        q: 'How do I get a print-quality result?',
        a: 'Export at the pixel dimensions the printer needs — 300 dpi across the physical size — and use a quality of 90 or above.',
      },
      {
        q: 'Why does my export look pixelated?',
        a: 'Because the output size was too small. The SVG itself is infinitely sharp; the resolution is entirely decided at export time.',
      },
    ],
    note: 'An SVG carries a `viewBox` rather than a size, so a rasteriser has to be told what dimensions to produce. Software that renders an SVG at a fixed default — often 300 by 150 pixels — is falling back on the SVG specification’s stated default, not on anything in your file.',
  },

  'svg-to-webp': {
    h1: 'SVG to WebP for a sharp graphic in a small file',
    intro:
      'Sometimes an SVG cannot be served — a platform strips it for security, or a template only accepts bitmaps. WebP is the best raster substitute: lossless mode keeps the flat colours and hard edges exact, transparency is preserved, and the file is smaller than the PNG equivalent.',
    steps: [
      'Bring in the SVG files. There is no sign-up, no upload and no size limit to work around.',
      'Choose the pixel dimensions you need. Export at twice the display size for high-density screens.',
      'Download. Use lossless for flat graphics and lossy only for illustrations with gradients.',
    ],
    faq: [
      {
        q: 'Why would a platform refuse an SVG?',
        a: 'Because it is executable XML. An SVG can carry scripts and external references, so many upload forms reject it rather than sanitise it.',
      },
      {
        q: 'Lossless or lossy?',
        a: 'Lossless for logos, icons and diagrams — the hard edges are the whole point and lossy compression blurs them. Lossy only for rich illustrations.',
      },
      {
        q: 'Is transparency kept?',
        a: 'Yes, as a full alpha channel, so anti-aliased edges stay smooth against any background.',
      },
      {
        q: 'Can I still get the SVG back?',
        a: 'No. Rasterising is one way — the shapes become pixels and there is nothing left to scale.',
      },
    ],
    note: 'Rasterising an SVG anti-aliases every edge against transparency, so the exported bitmap has partially-transparent pixels along every curve. That is exactly why a format with a real alpha channel matters here and why GIF would not do.',
  },

  'svg-to-bmp': {
    h1: 'SVG to BMP for instruments and firmware that read raw bitmaps',
    intro:
      'Embedded displays, industrial control panels and test equipment often accept a plain bitmap and nothing else, because decoding anything more modern would need a library they have no room for. Rasterising an SVG straight to BMP produces exactly the buffer they expect.',
    steps: [
      'Load the SVG files into the queue, in whatever order you would like them handled.',
      'Set the exact pixel dimensions the device expects — usually its screen resolution.',
      'Download the BMP and copy it to the device.',
    ],
    faq: [
      {
        q: 'What size should I export?',
        a: 'Exactly the device’s resolution. Firmware that reads a BMP directly into a framebuffer usually cannot scale, and a mismatch shows up as a clipped or repeated image.',
      },
      {
        q: 'What happens to transparency?',
        a: 'It is composited onto white. BMP transparency is unreliable enough that assuming it exists is the wrong bet for embedded work.',
      },
      {
        q: 'How large will the file be?',
        a: 'Width times height times three bytes plus a small header — a 480 by 320 panel image is about 460 KB.',
      },
      {
        q: 'Which BMP variant is produced?',
        a: 'A standard uncompressed 24-bit Windows bitmap, which is the variant simple readers handle.',
      },
    ],
    note: 'BMP stores its rows bottom-to-top by default. Firmware that expects top-down order will display the graphic upside down, and the usual fix is on the device side rather than in the file.',
  },
}
