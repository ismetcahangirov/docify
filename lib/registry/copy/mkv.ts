/**
 * Copy for the five conversions that turn an MKV into another moving picture.
 *
 * An MKV is a library file: downloaded, ripped or archived, usually with more
 * tracks in it than anything else will accept. Every page here is about what
 * happens to those extra tracks on the way out.
 */

import type { PairCopy } from './types'

export const MKV_VIDEO_COPY: Readonly<Record<string, PairCopy>> = {
  'mkv-to-mp4': {
    h1: 'MKV to MP4 so a television will finally play the file',
    intro:
      'Matroska is the format a media library is stored in and the one consumer hardware most often refuses. Smart televisions, games consoles, phones and streaming sticks want MP4. Where the video inside is already H.264 or HEVC, the conversion is a container change and the picture is untouched.',
    steps: [
      'Add the MKV file. Multi-gigabyte files are fine — nothing is uploaded.',
      'Convert. Streams the MP4 container can carry are copied rather than re-encoded.',
      'Download the MP4 and put it on the device.',
    ],
    faq: [
      {
        q: 'Will this take hours on a large film?',
        a: 'Not if the streams can be copied, which is the common case for H.264 and HEVC — that finishes in seconds. A re-encode is only needed when the codec inside is one MP4 cannot hold.',
      },
      {
        q: 'What happens to my subtitle tracks?',
        a: 'They generally do not survive. MP4 supports far fewer subtitle formats than Matroska, so the usual answer is to keep them as separate `.srt` files beside the video.',
      },
      {
        q: 'And the extra audio tracks?',
        a: 'MP4 can hold several, but many players only expose the first. If a specific language matters, check which track ends up first.',
      },
      {
        q: 'Do chapter markers carry over?',
        a: 'Rarely, and inconsistently between players. Chapters are one of the things Matroska does properly and MP4 treats as an afterthought.',
      },
    ],
    note: 'MKV is the reason a file plays perfectly on a computer and not at all on a television: the picture inside is usually fine, and the set has no Matroska demuxer. Changing the container is often the entire fix.',
  },

  'mkv-to-webm': {
    h1: 'MKV to WebM to put a library file on a web page',
    intro:
      'WebM is a narrowed profile of the same Matroska container, restricted to codecs a browser can decode. Converting an MKV means re-encoding whatever it holds into VP9 and Opus so that a plain `<video>` tag will play it — which is a real encode, and a slow one on a long file.',
    steps: [
      'Add the MKV and trim it to the section you are publishing.',
      'Choose a quality or a target size. VP9 encoding is slow, so start with a short excerpt.',
      'Download the WebM and embed it.',
    ],
    faq: [
      {
        q: 'Why is this so much slower than converting to MP4?',
        a: 'Because MP4 can usually copy the existing H.264 stream and WebM cannot — VP9 is a different codec, so every frame has to be encoded from scratch in software.',
      },
      {
        q: 'Should I convert a whole film?',
        a: 'Rarely worth it. WebM suits short web clips; for a full-length file, MP4 is faster to produce and more widely playable.',
      },
      {
        q: 'What happens to subtitles?',
        a: 'WebM supports WebVTT and little else, so styled or bitmap subtitles from an MKV are lost. Serve them as a separate WebVTT track instead.',
      },
      {
        q: 'Is the quality worse?',
        a: 'Slightly, since this is a second lossy generation. VP9 is efficient enough that a generous setting keeps it hard to see.',
      },
    ],
    note: 'WebM is defined as a subset of Matroska rather than a separate format, so the container work here is trivial and the codec work is all of it. That asymmetry is why the conversion feels so much heavier than MKV to MP4.',
  },

  'mkv-to-mov': {
    h1: 'MKV to MOV for importing a library file into Apple software',
    intro:
      'Final Cut, iMovie and QuickTime do not open Matroska, and no plug-in makes them. Converting to MOV puts the video into a container Apple’s media framework reads, re-encoding it where the codec inside the MKV is one that framework has never supported.',
    steps: [
      'Choose the MKV files you want converted; several at a time is no problem at all.',
      'Use a generous quality setting — this file is heading into an editor.',
      'Download the MOV and import it.',
    ],
    faq: [
      {
        q: 'Why will QuickTime not open an MKV?',
        a: 'Apple has never shipped a Matroska demuxer. The video inside may be perfectly supported; the container is what stops it.',
      },
      {
        q: 'Will the video be re-encoded?',
        a: 'Only if it has to be. H.264 can move across as it is; anything Apple’s framework will not decode has to be converted.',
      },
      {
        q: 'What about the subtitle tracks?',
        a: 'They do not come with it. Extract them as `.srt` before converting if you need them.',
      },
      {
        q: 'Is MOV better than MP4 for this?',
        a: 'Not technically — they are near-identical containers. Some Apple import dialogs simply prefer the extension.',
      },
    ],
    note: 'Matroska stores every element as an identifier, a length and a payload, which lets a parser skip anything it does not know. QuickTime’s box structure works the same way, which is why the container conversion itself is straightforward and the codec question is the whole difficulty.',
  },

  'mkv-to-avi': {
    h1: 'MKV to AVI for hardware from a different decade',
    intro:
      'This bridges the most capable container in common use to one of the least. AVI cannot hold modern subtitles, multiple audio tracks, chapters or variable frame rates, and a device that asks for it cannot handle any of those either — which is exactly why the conversion is sometimes the only thing that works.',
    steps: [
      'Put the MKV files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. The video is re-encoded into a codec AVI carries reliably.',
      'Download and copy the AVI to the device.',
    ],
    faq: [
      {
        q: 'What am I losing?',
        a: 'Subtitles, extra audio tracks, chapters, and any frame-rate variation. What remains is one video track and one audio track, which is all AVI was ever designed to hold.',
      },
      {
        q: 'Why is the file larger?',
        a: 'Per-frame overhead plus a less efficient codec. Expect twenty to forty percent more than the MKV for the same picture.',
      },
      {
        q: 'What about films over 4 GB?',
        a: 'AVI’s index uses 32-bit offsets and becomes unreliable past that. Reduce the quality or split the file if you cross it.',
      },
      {
        q: 'Should I try MP4 first?',
        a: 'Yes. Most devices that read AVI also read MP4, and the MP4 will be smaller and better in every respect.',
      },
    ],
    note: 'The gap between these two formats is twenty years of thinking about what a video file is. AVI assumes a fixed-rate sequence of frames; Matroska assumes an arbitrary set of timed streams with no fixed relationship. Everything lost here is in that gap.',
  },

  'mkv-to-gif': {
    h1: 'MKV to GIF, a scene as an animation that plays inline',
    intro:
      'Pulling a few seconds out of a library file and turning them into a GIF is what forums, chat apps and issue trackers accept when they refuse a video. Trim hard before converting: GIF has essentially no compression between frames, so length drives the file size more than anything else.',
    steps: [
      'Add the MKV and trim to the few seconds you want.',
      'Reduce the width to around 480 pixels and the frame rate to 10 or 12.',
      'Convert and check the size before you post it.',
    ],
    faq: [
      {
        q: 'How long a clip is realistic?',
        a: 'Under ten seconds for anything you intend to attach. A GIF stores frames almost independently, so a minute of film is hundreds of megabytes.',
      },
      {
        q: 'Why do dark scenes look banded?',
        a: 'A 256-colour palette has very few entries to spend on subtle shadow gradations. Dark, low-contrast footage is the worst case for GIF.',
      },
      {
        q: 'Is the sound kept?',
        a: 'No. GIF has no audio track at all, so a scene with dialogue in it arrives silent and stays that way.',
      },
      {
        q: 'Do the subtitles appear?',
        a: 'Only if they were already burned into the picture. Separate subtitle tracks are dropped, because GIF has nowhere to put them.',
      },
    ],
    note: 'GIF encodes each frame against a palette and can mark unchanged regions as transparent, which is a form of inter-frame compression — but only for pixels that are exactly identical. Film grain defeats it completely, which is why cinematic footage compresses so much worse than a screen recording.',
  },
}
