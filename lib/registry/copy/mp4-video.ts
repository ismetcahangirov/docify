/**
 * Copy for the five conversions that turn an MP4 into another moving picture.
 *
 * Split from `./mp4-audio` because MP4 has eleven target pages between them and
 * one file holding all of it would run past the size CLAUDE.md §5.2 allows. The
 * division is also the honest one: these five keep the picture, and those six
 * throw it away.
 */

import type { PairCopy } from './types'

export const MP4_VIDEO_COPY: Readonly<Record<string, PairCopy>> = {
  'mp4-to-webm': {
    h1: 'MP4 to WebM for a video that can be embedded without a licence',
    intro:
      'WebM exists so that a video can be put on a page without paying anyone. It carries VP9 or AV1 rather than H.264, both royalty-free, and every current browser plays it natively. For a background video, a product loop or an open-source project, it is the container that avoids the question entirely.',
    steps: [
      'Add the MP4 file. Long videos are fine; nothing leaves your device.',
      'Choose a quality or a target size. VP9 is slower than H.264, so expect this to take longer than the original encode did.',
      'Download the WebM and embed it.',
    ],
    faq: [
      {
        q: 'Will Safari play a WebM?',
        a: 'Safari 14.1 and later plays VP9 in WebM. Older versions do not, which is why a page serving WebM usually offers an MP4 alongside it.',
      },
      {
        q: 'Is WebM smaller than MP4?',
        a: 'VP9 is roughly thirty percent more efficient than H.264 at the same quality, so yes for a matched setting — at the cost of a much slower encode.',
      },
      {
        q: 'Why does this take so long?',
        a: 'H.264 has hardware encoders in almost every device; VP9 mostly does not, so the work happens in software. A long video can take several times its own duration.',
      },
      {
        q: 'What happens to the audio?',
        a: 'It is re-encoded to Opus, which is what WebM carries. Opus is excellent at every bitrate and is supported wherever WebM is.',
      },
    ],
    note: 'WebM is a restricted profile of Matroska: same container structure, but limited to a specific set of codecs so that a browser can implement it without a general-purpose demuxer. That restriction is the whole design.',
  },

  'mp4-to-mov': {
    h1: 'MP4 to MOV for Final Cut, QuickTime and Apple’s side of the fence',
    intro:
      'Some Apple software still prefers a `.mov` extension even though the file inside is almost identical. Final Cut import lists, older QuickTime workflows and a few broadcast tools check the extension rather than the contents. This produces a MOV that those tools will accept without complaint.',
    steps: [
      'Drop the MP4 files onto the page, or reach for the file picker if you prefer.',
      'Convert. Where the streams can simply be copied across, they are, and nothing is re-encoded.',
      'Download the finished MOV and carry on with whatever needed it in the first place.',
    ],
    faq: [
      {
        q: 'Are MP4 and MOV really the same thing?',
        a: 'Almost. MP4 was standardised from Apple’s QuickTime container in 2001, and the two share the same box structure. The differences are in which metadata boxes are allowed, not in how video is stored.',
      },
      {
        q: 'Does the video get re-encoded?',
        a: 'Not when it does not have to. If the source holds H.264 and AAC, the streams are copied into the new container untouched — which is instant and completely lossless.',
      },
      {
        q: 'Will the file be the same size?',
        a: 'Within a fraction of a percent, when the streams are copied. Only the container headers change.',
      },
      {
        q: 'Why does my editor still refuse it?',
        a: 'Then it is objecting to the codec rather than the container. Professional editors often want ProRes or DNxHD, which is a re-encode rather than a rewrap.',
      },
    ],
    note: 'A stream copy rewrites only the index and the headers, so a two-hour film converts in about a second and comes out bit-identical in every frame. Any tool that takes minutes over this conversion is re-encoding when it does not need to.',
  },

  'mp4-to-mkv': {
    h1: 'MP4 to MKV to keep subtitles and several audio tracks together',
    intro:
      'Matroska holds things MP4 cannot: any number of subtitle tracks in any format, several audio languages, chapter markers and attachments, all in one file. For a media library played through Plex, Kodi or VLC it is the container that keeps a film and everything about it in a single place.',
    steps: [
      'Choose the MP4 files you want converted; several at a time is no problem at all.',
      'Convert. The video and audio streams are carried over as they are wherever possible.',
      'Download the MKV and add it to your library.',
    ],
    faq: [
      {
        q: 'What does MKV give me that MP4 does not?',
        a: 'Unlimited tracks of any type, proper chapter support, attached fonts for styled subtitles, and no restriction on which codecs may go inside.',
      },
      {
        q: 'Will my television play an MKV?',
        a: 'Many will, and many will not — it is the one real cost of the format. MP4 is the safer choice for hardware playback; MKV is the better choice for a media server that transcodes on the fly.',
      },
      {
        q: 'Is quality lost?',
        a: 'No, where the streams are copied. This is a container change, not a re-encode.',
      },
      {
        q: 'Can I add subtitles during the conversion?',
        a: 'Not here — this converts what the MP4 already contains. Adding external subtitle files is a muxing operation rather than a format conversion.',
      },
    ],
    note: 'Matroska is designed to be extensible in a way MP4 is not: unknown elements can be skipped safely, so a new feature does not break old players. That is why it accumulated features MP4 would have needed a new specification revision for.',
  },

  'mp4-to-avi': {
    h1: 'MP4 to AVI for equipment that stopped being updated in 2008',
    intro:
      'Old DVD players, digital photo frames, in-car entertainment systems and some industrial displays list AVI as their only video format. Converting to it means going back to a container from 1992, which cannot do modern streaming or variable frame rates — but which those devices will actually play.',
    steps: [
      'Put the MP4 files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. The video is re-encoded to a codec the old container carries reliably.',
      'Download the AVI and copy it to the device.',
    ],
    faq: [
      {
        q: 'Why does the file get bigger?',
        a: 'AVI has substantial per-frame overhead and none of the modern container features that keep MP4 compact. A twenty to thirty percent increase for the same picture is normal.',
      },
      {
        q: 'Will the audio stay in sync?',
        a: 'It should, but AVI has no proper support for variable frame rates. A source recorded at a variable rate — most phone screen recordings — is converted to a constant one, which is what keeps it in sync.',
      },
      {
        q: 'Can AVI hold subtitles?',
        a: 'Not usefully. Subtitles have to be burned into the picture or shipped as a separate file beside it.',
      },
      {
        q: 'Is this ever the right choice for a new project?',
        a: 'No. AVI is only worth targeting when a specific device demands it.',
      },
    ],
    note: 'AVI predates the idea of a container that describes its own timing: it assumes a constant frame rate and a fixed audio rate throughout. Every awkward thing about converting to it follows from that one assumption.',
  },

  'mp4-to-gif': {
    h1: 'MP4 to GIF, a short clip that plays inside anything',
    intro:
      'A GIF plays in a chat window, a bug tracker, a README and an email, all of which refuse to embed a video. It is the wrong format by every technical measure and the right one whenever the destination will not host a player. Keep the clip short — GIF has no motion compression worth the name.',
    steps: [
      'Add the MP4 and trim it to the few seconds that matter.',
      'Reduce the width and the frame rate. 480 pixels wide at 12 frames a second is a good starting point.',
      'Convert and download. Check the size before you attach it anywhere.',
    ],
    faq: [
      {
        q: 'Why is my GIF twenty megabytes?',
        a: 'Because GIF stores frames almost independently — there is no motion prediction between them. Ten seconds of video becomes hundreds of near-complete images. Cut the length, the width and the frame rate, in that order.',
      },
      {
        q: 'Where did the audio go?',
        a: 'GIF has no audio track at all. If the sound matters, the destination needs a video.',
      },
      {
        q: 'Why does the colour look wrong?',
        a: 'Every frame is squeezed into 256 colours. A palette is generated from the clip itself, which handles most footage well and struggles with gradients and sunsets.',
      },
      {
        q: 'What frame rate should I use?',
        a: 'Between 10 and 15. Below that the motion stutters; above it the file grows roughly in proportion for very little visible gain.',
      },
    ],
    note: 'GIF frame delays are stored in hundredths of a second, so only rates that divide evenly are exact — 10, 20, 25 and 50 frames per second. Anything else is rounded, which is why a 30 fps GIF plays slightly slow in some browsers and correctly in others.',
  },
}
