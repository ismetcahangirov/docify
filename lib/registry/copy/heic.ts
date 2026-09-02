/**
 * Copy for the six conversions that start from an iPhone photo.
 *
 * The shared fact behind all of them — HEIC is the iOS default and most
 * software cannot open it — is deliberately said once, in `heic-to-jpg`, and
 * approached from a different angle on each of the others. Repeating it six
 * times is exactly the templating the uniqueness gate exists to catch.
 */

import type { PairCopy } from './types'

export const HEIC_COPY: Readonly<Record<string, PairCopy>> = {
  'heic-to-jpg': {
    h1: 'HEIC to JPG, so Windows will finally open your photos',
    intro:
      'Every iPhone since iOS 11 saves photos as HEIC. Email them to a Windows machine, upload them to an older website or open them in almost any desktop editor and you get an error rather than a picture. Converting to JPG solves it permanently: the same photo, in the one format nothing has ever refused.',
    steps: [
      'Drop the HEIC files straight from your phone or your camera roll export — as many as you like at once.',
      'Pick a JPEG quality. 85 is indistinguishable from the original on a photograph and keeps the file about half the size of a maximum-quality save.',
      'Download the JPGs individually, or take the whole batch as one ZIP.',
    ],
    faq: [
      {
        q: 'Will the converted JPG look worse than the HEIC?',
        a: 'Not visibly, at a sensible quality setting. HEIC is already a lossy format, so the photo has been compressed once; re-encoding at quality 85 or above adds a second pass that is very hard to see on camera output. If you want to be certain, use 95.',
      },
      {
        q: 'Why is the JPG so much bigger than the HEIC it came from?',
        a: 'HEIC uses HEVC, a video codec, and is roughly twice as efficient as JPEG at the same visible quality. A 2 MB HEIC becoming a 4 MB JPG is normal and is the price of universal compatibility.',
      },
      {
        q: 'Does the photo keep its date, location and camera settings?',
        a: 'Turn on “keep metadata” and the EXIF block travels across, so the date taken, the camera model and the GPS coordinates survive. Leave it off if you are about to share the photos publicly and would rather not publish where they were taken.',
      },
      {
        q: 'Can I convert a Live Photo?',
        a: 'The still frame converts and the motion does not. A Live Photo is a HEIC plus a separate short MOV, and only the HEIC half is a picture — the video component stays behind as its own file on the phone.',
      },
    ],
    note: 'Apple shipped HEIC as the camera default in iOS 11 in 2017 and never made it the default anywhere else. Windows can be taught to read it with a paid codec pack from the Microsoft Store, which is why converting is usually faster than fixing the machine.',
  },

  'heic-to-png': {
    h1: 'HEIC to PNG, with nothing thrown away in the second pass',
    intro:
      'PNG is the right target when the photo is going to be edited again, annotated, or cropped and re-saved several times. It compresses losslessly, so every subsequent save is free of the generational blurring that repeated JPEG encoding introduces around edges and text.',
    steps: [
      'Add your HEIC files. Screenshots taken on an iPhone are HEIC too, and they are the ones PNG suits best.',
      'Leave the settings alone — PNG has no quality dial, because it discards nothing.',
      'Save the results. Expect files several times larger than the HEIC you started with.',
    ],
    faq: [
      {
        q: 'Is PNG really lossless if HEIC already lost data?',
        a: 'Yes, but only from this point on. The compression HEIC applied on the phone is permanent; PNG guarantees that nothing further is lost, which is what matters if the file is about to go through an editor.',
      },
      {
        q: 'Why is my PNG ten times the size of the HEIC?',
        a: 'PNG is designed for flat colour and hard edges, and photographs are neither. Its filters find almost nothing to predict in camera noise, so a photograph in PNG approaches its uncompressed size. For a photo you are only going to look at, JPG or WebP is the better answer.',
      },
      {
        q: 'Does transparency come across?',
        a: 'A camera HEIC has no transparency to carry — the sensor records opaque pixels. The alpha channel matters in the other direction: PNG is what you convert *to* when something downstream needs one.',
      },
      {
        q: 'Are screenshots better off as PNG?',
        a: 'Much. A screenshot is mostly flat panels and text, which is what PNG compresses well and what JPEG turns into a halo of artefacts around every letter.',
      },
    ],
    note: 'HEIC files can hold several images in one container — a burst, an HDR set, or a photo with its depth map. Only the primary image is converted, which is the one the Photos app shows you.',
  },

  'heic-to-webp': {
    h1: 'HEIC to WebP for the web, without going back to 1992',
    intro:
      'Putting iPhone photos on a website means leaving HEIC, because no browser will display it. Falling back to JPEG throws away most of the size advantage you had. WebP is the middle answer: universally supported since 2020 and roughly thirty percent smaller than JPEG at matched quality.',
    steps: [
      'Drop in the HEIC files you want to publish.',
      'Choose a quality. 80 is the usual web setting and produces files noticeably smaller than the JPEG equivalent.',
      'Download and upload. Every browser released in the last five years will render them.',
    ],
    faq: [
      {
        q: 'How much smaller is WebP than JPEG here?',
        a: 'Around twenty-five to thirty-five percent for photographic content at the same perceived quality. The saving is largest on smooth areas — skies, skin, walls — and smallest on busy detail.',
      },
      {
        q: 'Which browsers cannot display WebP?',
        a: 'Internet Explorer, and Safari before version 14. Every browser shipped since 2020 supports it, including Safari on iOS.',
      },
      {
        q: 'Should I use WebP or AVIF for a website?',
        a: 'WebP if you want one file that simply works. AVIF is smaller again but takes far longer to encode and is still missing from some older Android and email clients.',
      },
      {
        q: 'Can WebP hold an animation like a GIF?',
        a: 'It can, but not from this conversion — a still HEIC has one frame, so the WebP produced here is a still image.',
      },
    ],
    note: 'HEIC and WebP both compress far better than JPEG, but for opposite reasons: HEIC borrows HEVC’s intra-frame prediction, while WebP borrows VP8’s. Converting between them is a full decode and re-encode, so quality is set by the target setting, not by the source.',
  },

  'heic-to-avif': {
    h1: 'HEIC to AVIF, trading one modern codec for a freer one',
    intro:
      'These two formats are technically close relatives — both wrap a video codec around a still image. HEIC uses HEVC, which is patent-encumbered and unsupported on the open web; AVIF uses AV1, which is royalty-free and rendered by every current browser. The move is about licensing and reach, not about quality.',
    steps: [
      'Add the HEIC files. Large batches are fine, but AVIF encoding is slow, so expect a wait.',
      'Set the quality. AVIF holds detail well at settings that would visibly damage a JPEG, so 60 to 70 is a reasonable starting point.',
      'Download the results once every file has finished encoding.',
    ],
    faq: [
      {
        q: 'Why does this take so much longer than converting to JPG?',
        a: 'AV1 encoding searches a far larger space of prediction modes than JPEG does. That search is what buys the file size, and it costs seconds per megapixel even with the SIMD-accelerated encoder this page uses.',
      },
      {
        q: 'Is AVIF smaller than HEIC?',
        a: 'Usually slightly, at the same visible quality, and the two are close enough that size is rarely the reason to switch. Browser support is.',
      },
      {
        q: 'Will an AVIF open on a Mac?',
        a: 'Yes — macOS Ventura and later, and iOS 16 and later, both preview AVIF natively. Older systems will need a browser to open it.',
      },
      {
        q: 'Does AVIF support transparency and wide colour?',
        a: 'Both, and it carries 10- and 12-bit depth as well. A photograph from an iPhone is 8-bit and opaque, so neither is exercised by this conversion.',
      },
    ],
    note: 'HEIC and AVIF share the same ISO base media container; only the codec inside differs. That is why the two formats have such similar capabilities and such completely different support: the container was never the obstacle, the HEVC patent pool was.',
  },

  'heic-to-tiff': {
    h1: 'HEIC to TIFF for print, archives and scanning workflows',
    intro:
      'Print shops, document management systems and a lot of scientific software accept TIFF and nothing else. It is the lingua franca of anything that predates the web. Converting an iPhone photo to TIFF is usually the last step before handing it to a system that will not negotiate about formats.',
    steps: [
      'Drop in the HEIC files destined for print or for an archive.',
      'Convert. TIFF is written losslessly here, so there is no quality setting to get wrong.',
      'Download. TIFF files are large — plan for roughly ten to twenty times the HEIC.',
    ],
    faq: [
      {
        q: 'Is TIFF actually better quality than the HEIC?',
        a: 'It cannot be. TIFF preserves exactly what it is given, and what it is given is a decoded HEIC. The value is that nothing further degrades, and that the receiving system will accept the file at all.',
      },
      {
        q: 'Why do print shops still ask for TIFF?',
        a: 'Because it is lossless, because it has held CMYK and embedded colour profiles since long before the web existed, and because every prepress tool written in the last thirty years reads it.',
      },
      {
        q: 'Can one TIFF hold several photos?',
        a: 'The format allows multiple pages, and this conversion writes one file per input photo. Multi-page TIFFs are a scanning convention rather than a photographic one.',
      },
      {
        q: 'Which colour profile does the TIFF get?',
        a: 'The one decoded from the source. iPhone photos are usually Display P3, and that profile is preserved rather than being flattened to sRGB.',
      },
    ],
    note: 'TIFF dates from 1986 and is really a container specification with dozens of optional compression schemes. Files written here are uncompressed or deflate-compressed, which is the combination the widest range of software can open without a plug-in.',
  },

  'heic-to-gif': {
    h1: 'HEIC to GIF when something old-fashioned needs to accept it',
    intro:
      'This is a niche conversion with one honest use: some forum, ticketing system or embedded device only takes GIF. The format is limited to 256 colours, so a photograph loses a great deal on the way in. It is worth doing when the receiving system leaves no alternative, and not otherwise.',
    steps: [
      'Add the HEIC photo you need as a GIF.',
      'Convert. The palette is chosen automatically from the colours actually present in the image.',
      'Download and check it — banding in skies and skin is the usual symptom of the 256-colour limit.',
    ],
    faq: [
      {
        q: 'Why does the GIF look blotchy?',
        a: 'A photograph contains tens of thousands of distinct colours and a GIF can hold 256. The encoder picks the best 256 and approximates the rest, which shows up first as banding across gradients.',
      },
      {
        q: 'Will the GIF be animated?',
        a: 'No. A still photo has one frame, so the result is a single-frame GIF.',
      },
      {
        q: 'Is there anything better for an old system?',
        a: 'PNG, if it is accepted — it is lossless, handles full colour, and is supported almost as widely as GIF. Try PNG first and fall back to GIF only if it is refused.',
      },
      {
        q: 'Is the GIF smaller than the HEIC?',
        a: 'Usually larger, despite the colour loss. GIF uses LZW compression from the 1980s, which is no match for a modern codec even with a fraction of the colours to encode.',
      },
    ],
    note: 'GIF has never supported partial transparency — a pixel is either fully opaque or fully invisible. That matters when a photograph is composited later, because there is no way to anti-alias the edge of a cut-out.',
  },
}
