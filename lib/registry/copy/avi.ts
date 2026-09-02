/**
 * Copy for the five conversions that turn an AVI into another moving picture.
 *
 * An AVI in 2026 is something recovered — a camcorder tape, an old hard drive,
 * an archive nobody has touched in fifteen years. The pages here are written
 * for somebody rescuing footage rather than producing it.
 */

import type { PairCopy } from './types'

export const AVI_VIDEO_COPY: Readonly<Record<string, PairCopy>> = {
  'avi-to-mp4': {
    h1: 'AVI to MP4, rescuing old footage into something that still plays',
    intro:
      'Camcorder captures, screen recordings from the 2000s and files from old hard drives are usually AVI, and modern phones, browsers and editors will not touch them. Converting to MP4 re-encodes the video into H.264, which every device made in the last fifteen years plays natively.',
    steps: [
      'Add the AVI files, however old they are.',
      'Pick a quality. Old footage is usually low resolution, so a generous setting costs little.',
      'Download the finished MP4 and carry on with whatever needed it in the first place.',
    ],
    faq: [
      {
        q: 'Why will my phone not play an AVI?',
        a: 'Because of what is inside it. Most AVIs hold DivX, Xvid, MJPEG or an uncompressed stream, and mobile hardware decoders only handle H.264, HEVC and AV1.',
      },
      {
        q: 'Will the picture look better afterwards?',
        a: 'No. Whatever the original codec lost is gone, and re-encoding can only preserve or slightly degrade it. Use a high quality setting to make sure it is the former.',
      },
      {
        q: 'Will the file get smaller?',
        a: 'Usually much smaller. H.264 is far more efficient than the codecs AVI typically carries, so a halving in size at the same visible quality is common.',
      },
      {
        q: 'Will the audio stay in sync?',
        a: 'Yes. AVI assumes a constant frame rate and MP4 records timing explicitly, so the timing is made explicit during the conversion.',
      },
    ],
    note: 'A great many AVI files hold Xvid or DivX, both descendants of an MPEG-4 Part 2 encoder leaked in 2001. Converting one to H.264 is a jump of one full codec generation, which is why the file so often shrinks dramatically.',
  },

  'avi-to-webm': {
    h1: 'AVI to WebM to put recovered footage on a web page',
    intro:
      'No browser will play an AVI, so archive footage destined for a website has to be re-encoded. WebM is the royalty-free target: VP9 video and Opus audio, played natively by every current browser, with no licensing question attached to hosting it.',
    steps: [
      'Bring in the AVI files. There is no sign-up, no upload and no size limit to work around.',
      'Choose a quality — old footage is usually small in resolution, so encoding is faster than it would be on modern video.',
      'Download the WebM and embed it.',
    ],
    faq: [
      {
        q: 'Why not just use MP4 on the web?',
        a: 'MP4 works and is more widely supported. WebM is the answer when you would rather not ship H.264, which carries patent licensing that WebM’s codecs do not.',
      },
      {
        q: 'Will Safari play it?',
        a: 'Safari 14.1 and later plays VP9 in WebM. Older versions do not, which is why sites often provide both.',
      },
      {
        q: 'Is the encode slow?',
        a: 'VP9 is slow in general, but archive AVI footage is typically 640 by 480 or smaller, which makes this one of the faster VP9 encodes you will run.',
      },
      {
        q: 'Should I upscale the old footage?',
        a: 'No. Upscaling adds pixels without adding detail and multiplies the encoding time. Serve it at its native size and let the browser scale it.',
      },
    ],
    note: 'Interlaced footage is common in AVI files from camcorders, and it shows up as comb-shaped artefacts on motion. Deinterlacing is a separate operation and worth doing before any web encode, because a codec will otherwise spend its bitrate encoding the comb.',
  },

  'avi-to-mov': {
    h1: 'AVI to MOV for editing archive footage in Apple software',
    intro:
      'Final Cut and iMovie will not import an AVI holding DivX, Xvid or MJPEG, which covers almost every AVI that still exists. Converting to MOV re-encodes the video into something Apple’s media framework reads, so decades-old footage can be cut alongside modern material.',
    steps: [
      'Load the AVI files into the queue, in whatever order you would like them handled.',
      'Use a generous quality setting — this is going into an editor and will be encoded again on export.',
      'Download the MOV and import it.',
    ],
    faq: [
      {
        q: 'Why does iMovie refuse my AVI?',
        a: 'Apple’s media framework has no decoder for the codecs old AVIs use. The container is a secondary problem; the codec is the real one.',
      },
      {
        q: 'What quality should I choose for editing?',
        a: 'High. An editing intermediate is re-encoded on export, and starting from a compressed copy compounds the loss.',
      },
      {
        q: 'Will the frame rate be preserved?',
        a: 'Yes. Old footage is frequently 25 or 29.97 frames a second, and both are carried across exactly rather than resampled.',
      },
      {
        q: 'Should I deinterlace first?',
        a: 'If the footage came from a camcorder, almost certainly. Interlacing artefacts become permanent once the file is re-encoded progressive.',
      },
    ],
    note: 'MJPEG AVIs — every frame a separate JPEG — were what early digital cameras and capture cards produced. They are enormous and, unusually, convert to a modern codec with almost no visible loss, because each frame is a complete picture rather than a prediction.',
  },

  'avi-to-mkv': {
    h1: 'AVI to MKV to give recovered footage somewhere to keep its subtitles',
    intro:
      'Old AVI files usually arrive with a separate subtitle file and no way to keep the two together. Matroska is the container that holds video, several audio tracks, subtitles and chapters in a single file, which makes it the sensible home for footage being archived properly.',
    steps: [
      'Add the AVI files, a whole folder at once if you like; nothing leaves your device.',
      'Convert. The video is carried across where the container allows and re-encoded where it does not.',
      'Download the MKV and file it with your library.',
    ],
    faq: [
      {
        q: 'Can I add my subtitle file during the conversion?',
        a: 'Not here — this converts what the AVI already contains. Adding an external subtitle track is a muxing step, done afterwards.',
      },
      {
        q: 'Is the video re-encoded?',
        a: 'Matroska will hold almost any codec, so where the AVI’s video can be copied it is, and nothing about the picture changes.',
      },
      {
        q: 'Will the file be smaller?',
        a: 'Slightly, when the streams are copied — Matroska has much less per-frame overhead than AVI. The saving is in the container, not the picture.',
      },
      {
        q: 'Does the 4 GB limit go away?',
        a: 'Yes. Matroska has no practical size ceiling, which is one of the concrete reasons to move an archive off AVI.',
      },
    ],
    note: 'AVI’s index sits at the end of the file and uses 32-bit offsets, so anything past 4 GB is unreachable and a truncated file is unplayable. Matroska interleaves seek points throughout, which is why a partially recovered MKV still plays.',
  },

  'avi-to-gif': {
    h1: 'AVI to GIF, a moment of old footage that plays in a browser',
    intro:
      'Turning a few seconds of archive video into a GIF is how it gets shared somewhere that will not host a player. Old AVI footage is usually low resolution to begin with, which is one of the rare cases where the format’s limitations line up with the source material.',
    steps: [
      'Add the AVI and trim to the seconds worth sharing.',
      'Keep the original width if it is already small, and set the frame rate to 10 or 12.',
      'Convert and check the resulting file size.',
    ],
    faq: [
      {
        q: 'Does low-resolution footage convert well?',
        a: 'Better than modern video does. A 320 by 240 clip produces a GIF a fraction of the size a high-definition source would, at the same length.',
      },
      {
        q: 'Why does motion look combed?',
        a: 'The source is interlaced. Camcorder AVIs almost always are, and the comb pattern becomes permanent in a GIF. Deinterlace before converting.',
      },
      {
        q: 'Is there any sound?',
        a: 'No. GIF has never had an audio track, so anything worth hearing in the footage has to travel as a separate file.',
      },
      {
        q: 'How long can the clip be?',
        a: 'Ten seconds is a practical ceiling for anything you intend to attach or embed, even at a small frame size.',
      },
    ],
    note: 'Grain and interlacing are the two things GIF handles worst, because both change every pixel on every frame and defeat the unchanged-region optimisation the format relies on. Old tape footage has plenty of both.',
  },
}
