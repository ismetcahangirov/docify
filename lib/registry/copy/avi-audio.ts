/**
 * Copy for the three conversions that take the sound out of an AVI.
 *
 * The audio in an old AVI is usually MP3 or uncompressed PCM rather than AAC,
 * which is what separates these three pages from the equivalents on the MP4 and
 * MOV sources: what can be copied and what has to be re-encoded is different.
 */

import type { PairCopy } from './types'

export const AVI_AUDIO_COPY: Readonly<Record<string, PairCopy>> = {
  'avi-to-mp3': {
    h1: 'AVI to MP3, saving the sound off an old recording',
    intro:
      'Home video, a recorded lecture or a concert captured on a camcorder is worth keeping for what was said and played, long after the picture stops being watchable. Extracting to MP3 leaves an audio file a fraction of the size that plays on anything with a speaker.',
    steps: [
      'Add the AVI file from your archive or old drive.',
      'Choose a bitrate — 192 kbps for music, 96 kbps for speech.',
      'Take the MP3 output from the results panel once the queue has finished working.',
    ],
    faq: [
      {
        q: 'Is the audio in an old AVI already MP3?',
        a: 'Often, yes. Files from the DivX era commonly carry an MP3 track, in which case the extraction adds no further generation of loss at all.',
      },
      {
        q: 'What if the audio is uncompressed?',
        a: 'Then this is the first compression it has been through, and a bitrate of 192 kbps or above will be transparent.',
      },
      {
        q: 'How much smaller is the MP3?',
        a: 'Typically ten to thirty times, since the video track is most of the file even in low-resolution footage.',
      },
      {
        q: 'The sound is out of sync in the video. Will that affect the audio?',
        a: 'No. Sync problems live in the relationship between the two tracks, and extracting the audio alone leaves a continuous, correct recording.',
      },
    ],
    note: 'AVI has no proper mechanism for variable-bitrate audio, so files with a VBR MP3 track drift out of sync as they play — the classic symptom of a badly muxed AVI. Pulling the audio out on its own sidesteps the problem entirely.',
  },

  'avi-to-wav': {
    h1: 'AVI to WAV for restoring audio off an old recording',
    intro:
      'Audio restoration work — removing tape hiss, reducing hum, rebalancing an old recording — is done on uncompressed samples, because every process compounds whatever compression is already there. Extracting an AVI’s soundtrack to WAV gives a restoration tool exactly what it needs to work on.',
    steps: [
      'Drop the AVI files onto the page, or reach for the file picker if you prefer.',
      'Convert. WAV is uncompressed, so there is nothing to set.',
      'Download and open it in your restoration or editing software.',
    ],
    faq: [
      {
        q: 'Is this the right starting point for restoration?',
        a: 'Yes. Every noise-reduction and equalisation pass would otherwise re-compress the material, and the artefacts accumulate. WAV means each step is exact.',
      },
      {
        q: 'Does it undo the original compression?',
        a: 'No. Whatever the MP3 or ADPCM track discarded is permanently gone. WAV guarantees nothing further is lost.',
      },
      {
        q: 'What sample rate will I get?',
        a: 'The recording’s own. Old camcorder audio is often 32 kHz or 22 kHz, which is preserved rather than resampled upward.',
      },
      {
        q: 'How large is the file?',
        a: 'About 10 MB a minute at CD rate, and less for the lower rates old footage usually carries.',
      },
    ],
    note: 'Camcorder AVIs frequently carry ADPCM audio — a simple 4-bit compression from the early 1990s that sounds thin and decodes trivially. Getting it into WAV is the first step in almost any attempt to make it listenable.',
  },

  'avi-to-m4a': {
    h1: 'AVI to M4A, old audio in a container a phone understands',
    intro:
      'An AVI will not appear in a phone’s music app or an Apple library at all. Converting the soundtrack to M4A produces AAC in a container those applications index, with proper support for a title, an artist and artwork that the original file had nowhere to store.',
    steps: [
      'Choose the AVI files you want converted; several at a time is no problem at all.',
      'Choose a bitrate. 128 kbps AAC is transparent for most archive material.',
      'Download the M4A and add it to your library.',
    ],
    faq: [
      {
        q: 'Is the audio re-encoded?',
        a: 'Yes. Old AVIs carry MP3, PCM or ADPCM, none of which can move into an M4A untouched, so the audio is decoded and re-compressed as AAC.',
      },
      {
        q: 'Why choose AAC over keeping the MP3?',
        a: 'For an Apple library, because M4A is what it indexes properly. If the source is already a good MP3 and you have no library requirement, extracting to MP3 avoids the extra generation.',
      },
      {
        q: 'What bitrate should I use?',
        a: 'At least as high as the source. Re-encoding a 128 kbps MP3 at 96 kbps compounds two lossy passes and it becomes audible.',
      },
      {
        q: 'Can I add artwork afterwards?',
        a: 'Yes. M4A supports full metadata, which is one of the practical reasons to move archive audio into it.',
      },
    ],
    note: 'AVI stores audio in fixed-size chunks interleaved with the video, an arrangement designed for reading off a CD-ROM at a constant rate. Nothing about it survives into a modern container, which is why this is always a real conversion and never a copy.',
  },
}
