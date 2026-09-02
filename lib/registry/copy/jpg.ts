/**
 * Copy for the seven conversions that start from a JPEG.
 *
 * JPEG is the format people already have, so every page here is about what the
 * *target* gives them that JPEG cannot: an alpha channel, a smaller file, a
 * printable master, a document. The source is the constant and is never the
 * story.
 */

import type { PairCopy } from './types'

export const JPG_COPY: Readonly<Record<string, PairCopy>> = {
  'jpg-to-png': {
    h1: 'JPG to PNG when the next save must not cost you anything',
    intro:
      'JPEG loses a little every time it is written. Crop a photo, save it, adjust it, save it again, and after half a dozen rounds the edges have visibly softened. PNG stops that clock: it compresses without discarding, so an image being worked on repeatedly stays exactly as good as it was.',
    steps: [
      'Add the JPGs you are about to edit, annotate or crop.',
      'Convert. There is nothing to configure, because PNG has no quality setting to trade away.',
      'Download, and do the rest of your editing in PNG.',
    ],
    faq: [
      {
        q: 'Does converting to PNG undo the JPEG compression?',
        a: 'No, and nothing can. The detail JPEG discarded is gone from the file. What PNG guarantees is that no further detail is lost from here on, which is the whole reason to do it before editing.',
      },
      {
        q: 'Will the PNG have a transparent background?',
        a: 'Not automatically. JPEG cannot store transparency, so every pixel arrives opaque. PNG gives you somewhere to *put* transparency once an editor cuts a background out.',
      },
      {
        q: 'Why did my 400 KB photo become a 4 MB PNG?',
        a: 'PNG compresses by predicting each pixel from its neighbours, which works beautifully on flat colour and barely at all on photographic noise. Photographs are the worst case for it.',
      },
      {
        q: 'Is PNG a good choice for a website photo?',
        a: 'Rarely. Use it for logos, icons, diagrams and screenshots; use JPG, WebP or AVIF for photographs, where the file will be several times smaller for no visible difference.',
      },
    ],
    note: 'PNG stores an 8-bit alpha channel, so a pixel can be any degree of transparent rather than simply on or off. That is why a PNG logo can sit on any background colour without a jagged fringe, and why it replaced GIF for interface graphics.',
  },

  'jpg-to-webp': {
    h1: 'JPG to WebP to make a page load without changing how it looks',
    intro:
      'The single cheapest performance win on most websites is re-encoding the photographs. WebP produces files roughly a third smaller than JPEG at the same perceived quality, and every browser released since 2020 displays it. The images look the same; the page arrives sooner.',
    steps: [
      'Drop in the JPGs currently on your site — the whole folder at once is fine.',
      'Set quality to 80 for a straight swap, or lower it to 70 if the images are decorative rather than the subject.',
      'Download the batch as a ZIP and replace the originals.',
    ],
    faq: [
      {
        q: 'Is re-encoding a JPEG into WebP lossy twice over?',
        a: 'Yes, and it is generally invisible at quality 80 or above. If a particular image matters and you still have the original camera file, encode from that instead of from the JPEG.',
      },
      {
        q: 'What saving should I actually expect?',
        a: 'Between twenty and forty percent for typical photographs. Images with large smooth areas save most; heavily textured images save least.',
      },
      {
        q: 'Do I still need a JPEG fallback?',
        a: 'Only if you support Internet Explorer or Safari 13. For everything else a plain `<img src="photo.webp">` is enough.',
      },
      {
        q: 'Does WebP keep EXIF data?',
        a: 'The format has a chunk for it, and this converter carries the metadata across when you ask it to. Leave it off if the photos are going public and you would rather not publish their coordinates.',
      },
    ],
    note: 'WebP’s lossy mode is VP8 keyframe compression, which predicts blocks from their neighbours before transforming them — something JPEG’s 1992 design does not do at all. That prediction step is where most of the thirty percent comes from.',
  },

  'jpg-to-avif': {
    h1: 'JPG to AVIF for the smallest photograph the web can display',
    intro:
      'AVIF compresses harder than anything else a browser will render — often half the size of the equivalent JPEG with no visible difference. The cost is encoding time, measured in seconds per image rather than milliseconds. That trade is worth it for images served thousands of times and pointless for a one-off.',
    steps: [
      'Add the JPGs you want to shrink. Encoding is slow, so start with a handful to judge the setting.',
      'Try quality 60. AVIF holds up at numbers that would leave a JPEG visibly blocky.',
      'Compare the result against the original before converting the rest of the library.',
    ],
    faq: [
      {
        q: 'Why is this so much slower than WebP?',
        a: 'AV1 evaluates far more prediction modes per block than VP8 does. The extra search is exactly what produces the smaller file, and it cannot be skipped without giving the saving back.',
      },
      {
        q: 'Which browsers still cannot show AVIF?',
        a: 'Chrome, Firefox, Edge, Safari 16 and later, and Android 12 and later all support it. Older Safari, older Android, and many email clients do not.',
      },
      {
        q: 'Should I keep the JPGs?',
        a: 'Keep them if they are the only copy. AVIF is smaller, not better — the detail your JPEG lost is still missing, and you cannot go back to the original from either file.',
      },
      {
        q: 'Does AVIF handle photographs with fine grain well?',
        a: 'Better than most codecs, because AV1 can synthesise film grain rather than encoding it pixel by pixel. On heavily grained scans the saving is dramatic.',
      },
    ],
    note: 'AVIF is a still frame of an AV1 video, wrapped in the same container HEIC uses. That heritage is why it supports 10-bit colour, HDR and transparency in one format — features JPEG would need three separate extensions to approach.',
  },

  'jpg-to-gif': {
    h1: 'JPG to GIF for the systems that have not moved on',
    intro:
      'Occasionally a form, a legacy CMS or a piece of embedded software will accept a GIF and nothing else. Converting a photograph into one means squeezing it into a 256-colour palette, which is a real loss on anything with a sky or a face in it. Worth doing when there is no alternative.',
    steps: [
      'Add the JPG that has to become a GIF.',
      'Convert. A palette is built from the colours the image actually uses, rather than from a fixed table.',
      'Download and check for banding before you rely on it.',
    ],
    faq: [
      {
        q: 'Why does the sky look striped?',
        a: 'A gradient needs hundreds of closely-spaced tones and GIF has 256 slots for the entire image. The encoder spends them where they help most, and smooth gradients are where the shortage shows first.',
      },
      {
        q: 'Can I get more than 256 colours into a GIF?',
        a: 'Not in a single frame. Some tools fake it by splitting an image across animation frames, which produces a file most software renders incorrectly.',
      },
      {
        q: 'Is the GIF smaller than the JPG?',
        a: 'Almost never. GIF uses LZW compression from 1984, which is far behind JPEG even when working with a fraction of the colours.',
      },
      {
        q: 'What should I use instead if I can?',
        a: 'PNG for lossless, WebP for small. GIF is only the right answer when the receiving system names it specifically.',
      },
    ],
    note: 'GIF’s LZW compression was patented until 2004, which is the whole reason PNG exists — it was designed in 1995 explicitly as a patent-free replacement, and ended up better at almost everything except animation.',
  },

  'jpg-to-tiff': {
    h1: 'JPG to TIFF for print shops and archives that insist on it',
    intro:
      'Prepress software, document management systems and institutional archives ask for TIFF because it is lossless, ancient and universally readable. If a printer has rejected your JPEG, this is the file they want. Nothing about the image improves — it simply stops degrading and starts being accepted.',
    steps: [
      'Add the JPGs your printer or archive has asked for.',
      'Convert. TIFF is written without loss, so there is no setting that could damage the result.',
      'Download. Expect files an order of magnitude larger than the JPGs.',
    ],
    faq: [
      {
        q: 'Does converting to TIFF improve print quality?',
        a: 'No. The compression artefacts already in the JPEG are preserved exactly. What you gain is a format the print workflow accepts and will not re-compress a second time.',
      },
      {
        q: 'Is the colour profile preserved?',
        a: 'Yes. If the JPEG carries an sRGB or Adobe RGB profile it is written into the TIFF, which matters because prepress tools take profiles seriously.',
      },
      {
        q: 'Uncompressed or compressed TIFF?',
        a: 'The files written here use lossless compression, which every major prepress and imaging application reads. If a system rejects it, it will almost certainly accept an uncompressed export instead.',
      },
      {
        q: 'Why is TIFF still used in 2026?',
        a: 'Because it is lossless, it has held CMYK and multi-page documents since the 1980s, and replacing it would mean re-certifying decades of scanning and printing equipment.',
      },
    ],
    note: 'TIFF is a container rather than a codec: the same extension covers uncompressed, LZW, deflate, JPEG-in-TIFF and several others. That flexibility is why some software reads one TIFF and rejects another with the same filename ending.',
  },

  'jpg-to-bmp': {
    h1: 'JPG to BMP for laboratory, industrial and legacy Windows tools',
    intro:
      'BMP stores pixels in the plainest way anything ever has: a header, then the colour values, in order. That is useless for storage and ideal for software that wants to read an image without a decoder. Machine vision rigs, laboratory instruments and old Windows utilities still ask for it.',
    steps: [
      'Add the JPG the instrument or utility has refused.',
      'Convert. There are no options — BMP has nothing to configure.',
      'Download. The file size is width times height times three bytes, plus a small header.',
    ],
    faq: [
      {
        q: 'Why is the BMP so enormous?',
        a: 'Because it is not compressed. A 12-megapixel photo occupies about 36 MB whatever the picture is of — a blank white frame and a detailed landscape cost precisely the same.',
      },
      {
        q: 'Is the BMP higher quality than the JPG?',
        a: 'It contains exactly what the JPEG decoded to, artefacts included. No detail is added by storing the same pixels less efficiently.',
      },
      {
        q: 'Will it open outside Windows?',
        a: 'Yes. Every major image viewer on macOS and Linux reads BMP, even though nothing on those systems writes it by default.',
      },
      {
        q: 'Does BMP support transparency?',
        a: 'The 32-bit variant has an alpha channel, but support for it is inconsistent and many readers ignore it. If transparency matters, use PNG.',
      },
    ],
    note: 'A BMP stores its rows bottom-up by default, a quirk inherited from OS/2 in 1987. It is invisible in a viewer and the reason a hand-written BMP parser so often produces an upside-down picture the first time.',
  },

  'jpg-to-pdf': {
    h1: 'JPG to PDF, several photos into one document you can send',
    intro:
      'Photographs of a signed contract, a receipt or a set of ID pages get sent back with a request for “one PDF, please”. This puts your images into a single document in the order you choose, which is what an email attachment, an upload form or a printer expects to receive.',
    steps: [
      'Add every JPG that belongs in the document. Drop them in reading order, or reorder them afterwards.',
      'Convert. Each photo becomes one page, sized to the image rather than cropped to a paper size.',
      'Download the single PDF and send it on.',
    ],
    faq: [
      {
        q: 'Can I combine several photos into one PDF?',
        a: 'Yes — that is the point. Drop in as many as you need and they become consecutive pages in the order they appear in the list.',
      },
      {
        q: 'Does the PDF re-compress my photos?',
        a: 'No. The JPEG data is embedded exactly as it arrived, so the document is about the size of the images added together and no quality is lost in the wrapping.',
      },
      {
        q: 'Will the text in a photographed document be searchable?',
        a: 'Not from this conversion. The pages are pictures of text, not text. Making them searchable needs optical character recognition, which is a different operation.',
      },
      {
        q: 'What page size do I get?',
        a: 'Each page matches its image, so a portrait photo makes a portrait page and a landscape photo a landscape one. Nothing is cropped and nothing is padded with white.',
      },
    ],
    note: 'PDF has been able to embed a JPEG stream without re-encoding it since version 1.2 in 1996. That is why a photo-to-PDF conversion is essentially free, and why the resulting file is almost exactly the size of the pictures inside it.',
  },
}
