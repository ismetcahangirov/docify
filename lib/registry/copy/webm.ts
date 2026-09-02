/**
 * Copy for the five conversions that turn a WebM into another moving picture.
 *
 * Nobody sets out to have a WebM. It arrives from a screen recorder, a browser
 * download or a web app export, and then something refuses it — which is where
 * every one of these pages starts.
 */

import type { PairCopy } from './types'

export const WEBM_VIDEO_COPY: Readonly<Record<string, PairCopy>> = {
  'webm-to-mp4': {
    h1: 'WebM to MP4 so the file will actually open outside a browser',
    intro:
      'Browser screen recorders, web-based meeting tools and a lot of download helpers hand you a WebM, and then Windows Media Player, iMovie, PowerPoint and most phones refuse it. MP4 is the format none of them have ever objected to, and it is what this conversion produces.',
    steps: [
      'Add the WebM file — a screen recording, a download, a browser export.',
      'Choose a quality, or accept the default, which aims to match the source.',
      'Download the MP4 and open it anywhere.',
    ],
    faq: [
      {
        q: 'Why can’t my video editor open a WebM?',
        a: 'Because it holds VP8, VP9 or AV1, and most desktop editors only license H.264 and HEVC decoders. The container is not the problem; the codec inside it is.',
      },
      {
        q: 'Is the video re-encoded?',
        a: 'Yes, and it has to be — an MP4 with VP9 inside would be just as unplayable as the WebM. That means a real encode and a small quality cost.',
      },
      {
        q: 'What quality setting should I use?',
        a: 'The default aims to be visually transparent. If the source is a screen recording with text, raise it: fine lettering is what suffers first in any re-encode.',
      },
      {
        q: 'Will the file get bigger?',
        a: 'Usually, by twenty to forty percent, because H.264 is less efficient than VP9. That is the price of being playable everywhere.',
      },
    ],
    note: 'A WebM from a browser screen recorder often has no duration in its header, because it was written as a live stream that could have ended at any moment. Converting to MP4 writes a proper index, which is what fixes the seek bar that would not drag.',
  },

  'webm-to-mov': {
    h1: 'WebM to MOV for Final Cut and the rest of the Apple toolchain',
    intro:
      'Apple’s editing tools have never accepted WebM, and screen recordings from a browser arrive in exactly that format. Converting to MOV re-encodes the video into something QuickTime, iMovie and Final Cut will import without a plug-in or a complaint about the codec.',
    steps: [
      'Add the WebM file you need converted, and wait for it to appear in the list.',
      'Set a quality high enough for editing — an editing master should be generous, not economical.',
      'Download the MOV and import it.',
    ],
    faq: [
      {
        q: 'Why does Final Cut refuse a WebM?',
        a: 'Apple has never shipped a VP9 or AV1 decoder in its media framework, so the file is unreadable to every application built on it.',
      },
      {
        q: 'Should I use a high quality setting?',
        a: 'Yes. This file is going into an editor and will be encoded again on export, so give the editor as much as you can afford.',
      },
      {
        q: 'Is a MOV different from an MP4 here?',
        a: 'Barely — the two containers are nearly identical. The MOV extension is what some Apple import dialogs are looking for.',
      },
      {
        q: 'What about ProRes?',
        a: 'That is the format Final Cut really wants for editing, and it is not produced here. This gives you an H.264 MOV, which imports cleanly and edits acceptably.',
      },
    ],
    note: 'QuickTime and WebM take opposite approaches to what a container may hold: QuickTime is a general format that Apple restricts by decoder availability, and WebM is deliberately restricted by specification so any browser can implement it completely.',
  },

  'webm-to-mkv': {
    h1: 'WebM to MKV, unlocking the container WebM was carved out of',
    intro:
      'WebM is a deliberately narrowed Matroska: the same structure, restricted to a handful of codecs so browsers could implement it fully. Converting to MKV removes that restriction, which matters when the file needs extra audio tracks, subtitles or chapters that WebM has no room for.',
    steps: [
      'Drop in the WebM files. They stay on this device from the first byte to the last.',
      'Convert. The streams are carried into the wider container as they are.',
      'Save the MKV result, and delete the original afterwards if you no longer need it.',
    ],
    faq: [
      {
        q: 'Is this really just a rename?',
        a: 'Close, but not quite. Both are Matroska, so the structure is shared, and the conversion writes a proper MKV header rather than the restricted WebM one. Renaming the file usually works and occasionally does not.',
      },
      {
        q: 'Is the video re-encoded?',
        a: 'No, when the streams can be copied. VP9 and Opus are both perfectly legal inside MKV.',
      },
      {
        q: 'What do I gain?',
        a: 'Subtitle tracks of any format, unlimited audio tracks, chapter markers, and attachments — everything Matroska allows and WebM’s profile excludes.',
      },
      {
        q: 'Will players still handle it?',
        a: 'VLC, MPV and most media servers will. Browsers will not, because they only accept the WebM profile.',
      },
    ],
    note: 'WebM is defined by a document that lists which Matroska elements are permitted, not by a separate file format. That is the entire technical difference between the two, and it is why this conversion is so nearly free.',
  },

  'webm-to-avi': {
    h1: 'WebM to AVI, from the newest container to one of the oldest',
    intro:
      'This is a compatibility conversion for hardware that stopped receiving updates a long time ago: DVD players, photo frames, car units and industrial displays that list AVI alone. It spans twenty-eight years of format design in one step, and everything about it is a concession to the receiving device.',
    steps: [
      'Select the WebM files, either by dropping them here or by pasting from the clipboard.',
      'Convert. The video is re-encoded into a codec AVI reliably carries.',
      'Download the AVI and copy it to the device.',
    ],
    faq: [
      {
        q: 'Why does the file grow so much?',
        a: 'Two reasons together: AVI has heavy per-frame overhead, and the codec chosen for compatibility is far less efficient than VP9. Doubling in size is not unusual.',
      },
      {
        q: 'Will audio stay in sync?',
        a: 'Yes, because the conversion normalises to a constant frame rate. WebM screen recordings are frequently variable rate, which AVI cannot express at all.',
      },
      {
        q: 'Is there a size limit?',
        a: 'AVI’s index uses 32-bit offsets, so files above 4 GB are unreliable. Trim or reduce quality if you approach it.',
      },
      {
        q: 'Would MP4 work instead?',
        a: 'Try it first. Most devices that read AVI also read MP4, and the result will be smaller and better.',
      },
    ],
    note: 'AVI was designed for Video for Windows in 1992, when a video was a fixed-rate sequence of frames on a CD. Nothing in it anticipated variable frame rates, streaming or files above four gigabytes, and every awkward part of this conversion is one of those three.',
  },

  'webm-to-gif': {
    h1: 'WebM to GIF for a screen recording that has to go in a ticket',
    intro:
      'Browser screen recorders produce WebM, and issue trackers, chat apps and README files will not embed one. A GIF is the lowest common denominator that plays inline everywhere. Keep it to a few seconds — the format stores frames almost independently and grows accordingly.',
    steps: [
      'Add the WebM and trim it to the part that demonstrates the point.',
      'Reduce the width to around 800 pixels for a screen recording, and the frame rate to 10.',
      'Convert, then check the size before attaching it.',
    ],
    faq: [
      {
        q: 'Do screen recordings convert well to GIF?',
        a: 'Better than anything else does. Interface graphics are flat colour with few distinct tones, which fits inside a 256-colour palette far more comfortably than camera footage.',
      },
      {
        q: 'Why is my GIF still huge?',
        a: 'Length is the biggest factor, then width, then frame rate. A twenty-second recording at full resolution will be tens of megabytes however the palette is chosen.',
      },
      {
        q: 'Is the text still readable?',
        a: 'At full width, yes — this is one case where a GIF holds up, because sharp text survives palette reduction well. Scaling down is what makes it illegible.',
      },
      {
        q: 'Is there a better option for a bug report?',
        a: 'If the tracker accepts video, use the WebM or an MP4 — smaller, sharper and with sound. GIF is for the places that do not.',
      },
    ],
    note: 'A screen recording usually has long stretches where almost nothing changes, and GIF can encode an unchanged region as a transparent no-op in the next frame. That optimisation is why interface captures compress so much better than camera footage does.',
  },
}
