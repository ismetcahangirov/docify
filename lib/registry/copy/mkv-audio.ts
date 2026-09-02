/**
 * Copy for the four conversions that take the sound out of an MKV.
 *
 * Matroska routinely carries several audio tracks in several languages, and
 * which one you get is the question every page here has to answer — it is the
 * thing that surprises people about extracting audio from a library file.
 */

import type { PairCopy } from './types'

export const MKV_AUDIO_COPY: Readonly<Record<string, PairCopy>> = {
  'mkv-to-mp3': {
    h1: 'MKV to MP3, the soundtrack out of a library file',
    intro:
      'A concert recording, a documentary or a lecture stored as Matroska is mostly picture, and the audio is what you want on a phone or in a car. MP3 is the extraction that plays absolutely everywhere, at a fraction of the size, with a bitrate you choose to suit the material.',
    steps: [
      'Add the MKV file you need converted, and wait for it to appear in the list.',
      'Pick a bitrate — 192 kbps for music, 96 kbps for speech.',
      'Download the MP3 files one at a time, or take the whole batch as a single archive.',
    ],
    faq: [
      {
        q: 'Which audio track do I get if there are several?',
        a: 'The first one in the file, which is usually the original language. To pick a different track you need to reorder or extract it beforehand.',
      },
      {
        q: 'How much smaller is the MP3?',
        a: 'Typically twenty to fifty times, since the video is nearly all of an MKV. A 4 GB film yields an audio file of well under 200 MB.',
      },
      {
        q: 'What if the MKV holds a surround track?',
        a: 'It is downmixed to stereo. MP3 supports two channels only, so a 5.1 mix is folded down rather than carried.',
      },
      {
        q: 'Is quality lost?',
        a: 'Some — the source audio is already compressed and this is a second lossy pass. At 192 kbps it is very hard to hear on music and inaudible on speech.',
      },
    ],
    note: 'Matroska marks tracks with a language code and a default flag, and extraction tools respect those flags rather than the physical order. A file whose default track is a commentary will hand you the commentary.',
  },

  'mkv-to-wav': {
    h1: 'MKV to WAV for editing and analysis at full precision',
    intro:
      'Audio restoration, forensic analysis and editing all want uncompressed samples with no codec in the way. Converting an MKV’s soundtrack to WAV performs the decode once and writes the result plainly, which is what those tools are built to open and what keeps every subsequent edit lossless.',
    steps: [
      'Drop in the MKV files. They stay on this device from the first byte to the last.',
      'Convert. WAV is uncompressed, so there is nothing to configure.',
      'Download and open it in your editor.',
    ],
    faq: [
      {
        q: 'Does WAV recover anything the compression removed?',
        a: 'No. It holds exactly what the decoder produced. Its value is that nothing further is lost through however many edits and saves follow.',
      },
      {
        q: 'How large will the file be?',
        a: 'Around 10 MB a minute for stereo at CD rate, and more for higher sample rates. A two-hour film soundtrack is well over a gigabyte.',
      },
      {
        q: 'What about the 4 GB limit?',
        a: 'WAV headers use 32-bit sizes and become unreliable beyond it — roughly six hours of stereo. Use FLAC for anything longer.',
      },
      {
        q: 'Are surround channels preserved?',
        a: 'WAV can hold multichannel audio, though many editors expect stereo and will only read the first two channels.',
      },
    ],
    note: 'The sample rate is taken from the source rather than resampled, so a film soundtrack extracts at 48 kHz and a music rip at 44.1. Software that assumes one or the other is a common cause of audio that plays at the wrong speed.',
  },

  'mkv-to-m4a': {
    h1: 'MKV to M4A for an Apple library that will not index Matroska',
    intro:
      'Apple Music, iTunes and the iOS Files app cannot see inside an MKV at all. Converting the audio to M4A produces AAC in a container those applications treat as music — with artwork, titles and chapter support that a bare stream could not carry.',
    steps: [
      'Select the MKV files, either by dropping them here or by pasting from the clipboard.',
      'Choose a bitrate. 128 kbps AAC is transparent for most material and smaller than the MP3 equivalent.',
      'Download the M4A and add it to your library.',
    ],
    faq: [
      {
        q: 'Is the audio re-encoded?',
        a: 'It depends on what is inside. AAC audio can often be copied across; AC-3, DTS and Vorbis all have to be decoded and re-compressed.',
      },
      {
        q: 'Why choose M4A rather than MP3?',
        a: 'AAC beats MP3 at every bitrate, Apple software prefers it, and there is a reasonable chance the audio can be copied without re-encoding at all.',
      },
      {
        q: 'Will chapters survive?',
        a: 'M4A supports chapters, though whether they carry across depends on how the MKV recorded them. Check in a player before relying on it.',
      },
      {
        q: 'What happens to a surround track?',
        a: 'AAC supports multichannel, but most players will downmix it. For a stereo listening copy, that is the outcome you want anyway.',
      },
    ],
    note: 'Films often carry AC-3 or DTS audio, neither of which an M4A can hold. That is the case where this conversion is a full re-encode rather than a repackage, and it is why the same operation is instant on one file and slow on another.',
  },

  'mkv-to-aac': {
    h1: 'MKV to AAC, the stream on its own for a broadcast chain',
    intro:
      'A bare `.aac` file is audio frames with a small header on each and nothing around them, which is what streaming ingest and broadcast encoders expect. Extracting from an MKV produces exactly that, re-encoding where the source audio is one of the surround codecs Matroska so often carries.',
    steps: [
      'Add the MKV files you want changed. The queue will take as many as you have.',
      'Set a bitrate matching what the receiving system expects.',
      'Save the AAC results. Each has its own link, and a batch has one archive as well.',
    ],
    faq: [
      {
        q: 'Why not extract to M4A?',
        a: 'M4A is the better listening format. A raw stream is for pipelines that cut and join at frame boundaries and have no use for an index.',
      },
      {
        q: 'Will it carry the track title or language?',
        a: 'No. There is no container, so all of Matroska’s track metadata is dropped.',
      },
      {
        q: 'Which track is extracted?',
        a: 'The default audio track, as flagged in the MKV. Reorder the tracks first if you need a different language.',
      },
      {
        q: 'Is a surround track preserved?',
        a: 'AAC can encode multichannel audio, though a downmix to stereo is the usual choice for anything heading into a stream.',
      },
    ],
    note: 'A DTS or AC-3 track cannot be repackaged as AAC under any circumstances — they are unrelated codecs. Films with those soundtracks always take the slow path through a full decode and re-encode.',
  },
}
