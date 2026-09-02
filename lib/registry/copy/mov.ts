/**
 * Copy for the five conversions that turn a MOV into another moving picture.
 *
 * A MOV is almost always straight off an iPhone, so these pages are written for
 * somebody who recorded something on a phone and hit a wall on a Windows
 * machine, a website or an editor.
 */

import type { PairCopy } from './types'

export const MOV_VIDEO_COPY: Readonly<Record<string, PairCopy>> = {
  'mov-to-mp4': {
    h1: 'MOV to MP4, instantly, without touching a single frame',
    intro:
      'An iPhone records into a MOV, and Windows Media Player, a great deal of web software and most upload forms would rather have an MP4. The two containers are so closely related that the video and audio can simply be copied across — no re-encoding, no quality loss, and a two-hour file done in about a second.',
    steps: [
      'Add the MOV straight from your phone or camera. Size is not a problem; nothing is uploaded.',
      'Convert. Where the streams can be copied they are, so this finishes almost immediately.',
      'Collect the MP4 files from the results panel below, individually or all together.',
    ],
    faq: [
      {
        q: 'Why is this so fast when other converters take minutes?',
        a: 'Because nothing is re-encoded. MOV and MP4 share the same underlying box structure, so the video and audio streams are copied into a new container and only the index is rewritten.',
      },
      {
        q: 'Is any quality lost?',
        a: 'None whatsoever. Every frame in the MP4 is byte-identical to the frame in the MOV. This is the one video conversion that is genuinely free.',
      },
      {
        q: 'Will the file be the same size?',
        a: 'Within a fraction of a percent of the original. Only the container headers and the index are rewritten; the frames themselves are the same bytes.',
      },
      {
        q: 'What if my MOV contains ProRes?',
        a: 'Then it has to be re-encoded, because ProRes in an MP4 is not something ordinary players handle. That conversion takes real time and does change the picture.',
      },
    ],
    note: 'MP4 was standardised in 2001 directly from Apple’s QuickTime file format, which is why a MOV and an MP4 holding H.264 differ only in a handful of header boxes. Everything convenient about this conversion follows from that shared ancestry.',
  },

  'mov-to-webm': {
    h1: 'MOV to WebM for a phone recording that has to live on a web page',
    intro:
      'Putting an iPhone clip on a website means leaving MOV, which no browser will play from a plain `<video>` tag reliably. WebM is the royalty-free answer: VP9 video and Opus audio, played natively by every current browser, with no licensing question attached to the embed.',
    steps: [
      'Add the MOV from your phone.',
      'Choose a quality or a target file size — VP9 is slow, so trim the clip first if you can.',
      'Download the WebM and put it on the page.',
    ],
    faq: [
      {
        q: 'Why does this take so much longer than converting to MP4?',
        a: 'Because MP4 can be a stream copy and this cannot. VP9 has to encode every frame from scratch, in software, since almost no device has a hardware VP9 encoder.',
      },
      {
        q: 'Will Safari play it?',
        a: 'Safari 14.1 and later, yes. Older versions will not, which is why most sites ship an MP4 alongside the WebM.',
      },
      {
        q: 'How much smaller will it be?',
        a: 'At matched quality, roughly thirty percent smaller than the H.264 original. On short clips the difference is less dramatic than the encoding time suggests.',
      },
      {
        q: 'What happens to the audio?',
        a: 'It is re-encoded to Opus, which is what WebM carries. Opus is better than AAC at low bitrates, so speech in particular holds up well.',
      },
    ],
    note: 'iPhone video is often recorded at a variable frame rate, and WebM handles that correctly where AVI cannot. That is why this conversion keeps audio in sync on a phone recording that other targets need resampling to fix.',
  },

  'mov-to-mkv': {
    h1: 'MOV to MKV for a media library rather than a camera roll',
    intro:
      'Matroska is what a home media server wants: several audio tracks, subtitles of any kind, chapter markers and no restriction on codecs, all in one file. Moving a MOV into it is a container change, so the picture is untouched and the clip gains everything MKV can carry later.',
    steps: [
      'Bring in the MOV files. There is no sign-up, no upload and no size limit to work around.',
      'Convert. The existing streams are carried over rather than re-encoded where possible.',
      'Download the MKV and drop it into your library folder.',
    ],
    faq: [
      {
        q: 'Does the video change at all?',
        a: 'No, when the streams are copied. The frames in the MKV are the frames from the MOV.',
      },
      {
        q: 'Why not just keep the MOV?',
        a: 'Because most media servers and set-top players treat MOV as a camera format and MKV as a library format. MKV also holds subtitles and multiple audio tracks, which MOV handles poorly.',
      },
      {
        q: 'Will my TV play an MKV?',
        a: 'It depends on the set. MKV support in hardware players is common but far from universal — MP4 is the safer target for direct playback.',
      },
      {
        q: 'Does the recording date survive?',
        a: 'Container metadata is largely rewritten, so treat the creation date as unreliable after any container change and keep the original if it matters.',
      },
    ],
    note: 'Matroska stores every element with an explicit identifier and length, so a player that meets something it does not recognise can skip it safely. That single design decision is why the format has absorbed twenty years of new features without breaking old files.',
  },

  'mov-to-avi': {
    h1: 'MOV to AVI for a device that predates the iPhone entirely',
    intro:
      'Older DVD players, car head units, digital photo frames and some industrial displays list AVI and nothing newer. Converting a phone recording to it means dropping back to a 1992 container with no variable frame rate and no modern streaming — which is precisely what those devices can handle.',
    steps: [
      'Load the MOV files into the queue, in whatever order you would like them handled.',
      'Convert. The video is re-encoded into a codec AVI carries dependably.',
      'Download the AVI and copy it across to the device.',
    ],
    faq: [
      {
        q: 'Why is the AVI larger than the MOV?',
        a: 'Per-frame overhead, and a codec configuration chosen for compatibility rather than efficiency. Twenty to thirty percent larger is typical.',
      },
      {
        q: 'Will the audio drift out of sync?',
        a: 'It should not. iPhone footage is often variable frame rate and AVI cannot express that, so the conversion normalises to a constant rate — which is exactly what prevents the drift.',
      },
      {
        q: 'Can I put subtitles in the AVI?',
        a: 'Not inside it. AVI has no real subtitle support, so they have to be burned into the picture or shipped as a separate file.',
      },
      {
        q: 'Is there any reason to choose AVI otherwise?',
        a: 'No. It is a compatibility target for specific hardware and nothing else.',
      },
    ],
    note: 'AVI’s index is stored at the end of the file and uses 32-bit offsets, so it breaks above 4 GB — the reason old players stop halfway through a long recording rather than refusing it outright.',
  },

  'mov-to-gif': {
    h1: 'MOV to GIF, a few seconds of phone video that plays in a message',
    intro:
      'Chat apps, issue trackers and email will not embed a video but will happily show a GIF. Turning a short phone clip into one is the standard way to demonstrate something in a place that has no player — as long as the clip stays short, because GIF has almost no motion compression.',
    steps: [
      'Add the MOV and trim it to the seconds that matter.',
      'Drop the width to around 480 pixels and the frame rate to 10 or 12.',
      'Convert, then check the file size before attaching it anywhere.',
    ],
    faq: [
      {
        q: 'My GIF is enormous. What do I change?',
        a: 'Length first, then width, then frame rate. GIF stores each frame almost independently, so every one of those three multiplies the file directly.',
      },
      {
        q: 'Why is there no sound?',
        a: 'GIF has no audio track. If the sound is part of the point, the destination needs a video file.',
      },
      {
        q: 'Why does the picture look posterised?',
        a: 'Each frame is reduced to 256 colours. A palette is built from the clip itself, which copes well with interfaces and screen recordings and badly with skies and skin.',
      },
      {
        q: 'How long can the clip be?',
        a: 'Practically, under ten seconds. Beyond that the file grows past what most services will accept as an attachment.',
      },
    ],
    note: 'A GIF from a phone recording is usually worse than the video it came from in every dimension — bigger, blockier, silent — and is still the right answer whenever the destination will not host a player. That trade is the only reason the format survives.',
  },
}
