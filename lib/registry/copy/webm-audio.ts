/**
 * Copy for the five conversions that take the sound out of a WebM.
 *
 * The audio inside a WebM is Opus or Vorbis rather than AAC, which changes the
 * technical answer on every page here: nothing can be copied out untouched, so
 * each one is a genuine re-encode and says so.
 */

import type { PairCopy } from './types'

export const WEBM_AUDIO_COPY: Readonly<Record<string, PairCopy>> = {
  'webm-to-mp3': {
    h1: 'WebM to MP3 for the audio out of a browser recording',
    intro:
      'A meeting recorded in a browser tab, a lecture captured by a web app or a stream saved from a page all arrive as WebM, and the part worth keeping is usually the sound. MP3 is the extraction that plays on anything with a speaker, at a size a fraction of the original.',
    steps: [
      'Add the WebM files you want changed. The queue will take as many as you have.',
      'Choose a bitrate — 96 kbps for speech, 192 kbps if there is music in it.',
      'Grab the MP3 from the results list, which appears as soon as the first job lands.',
    ],
    faq: [
      {
        q: 'Is this a second lossy conversion?',
        a: 'Yes. WebM audio is Opus or Vorbis, and neither can be repackaged as MP3 — the audio has to be decoded and re-compressed. Use a generous bitrate to keep the second generation inaudible.',
      },
      {
        q: 'Why not keep the Opus audio?',
        a: 'You can, by converting to OGG instead, which is a much cleaner route. MP3 is for the players and services that will not take anything else.',
      },
      {
        q: 'How much smaller than the WebM?',
        a: 'Usually ten to twenty times, if the WebM had video in it. For an audio-only WebM the MP3 will be similar in size or slightly larger.',
      },
      {
        q: 'What bitrate for a recorded meeting?',
        a: '96 kbps mono. Speech does not benefit from more, and the file is a quarter the size of a stereo music setting.',
      },
    ],
    note: 'Opus and MP3 divide the signal in fundamentally different ways — Opus switches between a speech model and a transform codec, MP3 always uses the transform. That mismatch is why re-encoding between them costs more than a simple bitrate change would suggest.',
  },

  'webm-to-wav': {
    h1: 'WebM to WAV for editing and transcription tools',
    intro:
      'Audio editors and speech recognition engines want uncompressed samples, and many refuse a WebM outright because they have no Opus decoder. Converting to WAV performs that decode once and writes the result plainly, which is exactly the input those tools are built around.',
    steps: [
      'Bring in the WebM files. There is no sign-up, no upload and no size limit to work around.',
      'Convert. WAV is uncompressed, so there is no setting to choose.',
      'Download and open it in your editor or transcription tool.',
    ],
    faq: [
      {
        q: 'Why do transcription tools refuse WebM?',
        a: 'Because they would need an Opus or Vorbis decoder, and most audio tooling only bundles decoders for MP3, AAC and PCM. WAV removes the question entirely.',
      },
      {
        q: 'Is any quality lost in this step?',
        a: 'None. The WAV holds exactly what the Opus decoded to. Whatever the original encode discarded is already gone and cannot be recovered.',
      },
      {
        q: 'How large is the result?',
        a: 'Around 10 MB per minute of stereo audio. An hour of meeting audio is roughly 600 MB.',
      },
      {
        q: 'Which sample rate is used?',
        a: 'Opus always decodes at 48 kHz, so that is what the WAV carries. Most transcription tools resample internally and will not mind.',
      },
    ],
    note: 'Opus is defined to decode at 48 kHz regardless of what it was fed, so a WAV extracted from a WebM is 48 kHz even if the microphone recorded at 44.1. That resampling happened in the original encode, not here.',
  },

  'webm-to-m4a': {
    h1: 'WebM to M4A for Apple devices and libraries',
    intro:
      'Apple Music, iTunes and the iOS Files app expect M4A, and none of them will index a WebM. Converting re-encodes the Opus audio into AAC and puts it in the container Apple software understands, complete with proper metadata support for titles and artwork.',
    steps: [
      'Load the WebM files into the queue, in whatever order you would like them handled.',
      'Choose a bitrate — 128 kbps AAC is transparent for most spoken and musical content.',
      'Download the M4A and add it to your library.',
    ],
    faq: [
      {
        q: 'Is the audio re-encoded?',
        a: 'Yes. Opus cannot live inside an M4A, so the audio is decoded and re-compressed as AAC. Choose a bitrate at or above the source’s to avoid compounding the loss.',
      },
      {
        q: 'Why not use MP3 for the same purpose?',
        a: 'AAC is better than MP3 at every bitrate, and Apple software prefers it. MP3 is only the better choice for very old hardware.',
      },
      {
        q: 'Can I add artwork afterwards?',
        a: 'Yes. M4A is a full container with proper tag support, which a bare stream would not have.',
      },
      {
        q: 'Will it sync to an iPhone?',
        a: 'Directly, with no extra step. M4A is the native audio convention across Apple’s applications and appears in Music without conversion.',
      },
    ],
    note: 'Opus was standardised in 2012 and AAC in 1997, and Opus wins comfortably below about 96 kbps. Converting downward in codec generation like this is done for compatibility, never for quality.',
  },

  'webm-to-aac': {
    h1: 'WebM to AAC, a raw stream for a broadcast pipeline',
    intro:
      'Streaming ingest, broadcast encoders and some embedded systems want a bare ADTS stream: audio frames with a small header on each and no container around them. This re-encodes the WebM’s Opus audio into exactly that shape, which is a specialist target rather than a listening one.',
    steps: [
      'Add the WebM files, a whole folder at once if you like; nothing leaves your device.',
      'Choose a bitrate to match what the receiving system expects.',
      'Download the `.aac` file and hand it over.',
    ],
    faq: [
      {
        q: 'How does this differ from converting to M4A?',
        a: 'The audio is the same; the packaging is not. M4A has an index and metadata, and a bare AAC stream has neither — which is what lets it be cut and joined anywhere.',
      },
      {
        q: 'Can I play it in a normal music app?',
        a: 'Usually, though seeking will be approximate and no title or artwork will appear. Use M4A for anything you intend to listen to.',
      },
      {
        q: 'Is quality lost?',
        a: 'Yes — Opus to AAC is a decode and a re-encode. Set the bitrate at least as high as the source to keep the second generation quiet.',
      },
      {
        q: 'Which AAC profile is produced?',
        a: 'AAC-LC, which is the profile every decoder supports. The high-efficiency profiles are better at very low bitrates and far less universally handled.',
      },
    ],
    note: 'ADTS repeats its header before every frame so a decoder can join a stream already in progress. That is what a broadcast pipeline needs and what a file-based container deliberately avoids paying for.',
  },

  'webm-to-ogg': {
    h1: 'WebM to OGG, keeping the codec and changing only the wrapper',
    intro:
      'A WebM’s audio is usually Opus, and Opus is what an Ogg file carries. This is therefore the cleanest audio extraction available from a WebM: the same codec, moved into the container that games, Linux tooling and the open web expect, with no second generation of loss where the streams line up.',
    steps: [
      'Drop the WebM files onto the page, or reach for the file picker if you prefer.',
      'Convert. The Opus audio moves into an Ogg container.',
      'Download the OGG output. Nothing is kept here once you close the tab.',
    ],
    faq: [
      {
        q: 'Why is this the best target for WebM audio?',
        a: 'Because both formats were designed around Opus. Every other audio target requires decoding and re-compressing; this one is the closest thing to a straight rewrap.',
      },
      {
        q: 'What if the WebM contains Vorbis instead?',
        a: 'Vorbis is also an Ogg-native codec, so the same reasoning applies. Older WebM files from around 2011 are the ones likely to hold it.',
      },
      {
        q: 'Will an OGG play on my phone?',
        a: 'Android has for years, and iOS since version 17. Anything older needs a player that bundles its own decoder, such as VLC.',
      },
      {
        q: 'Is OGG better than MP3?',
        a: 'Substantially, at the same bitrate — Opus is twenty-five years newer. MP3 wins only on where it will play.',
      },
    ],
    note: 'Ogg and Matroska solve the same problem in different eras: both interleave timed streams with enough structure to seek. Ogg pages carry checksums so a corrupt file resynchronises, which is why internet radio adopted it first.',
  },
}
