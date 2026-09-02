/**
 * Copy for the eight conversions that start from an M4A or a FLAC.
 *
 * Two sources with opposite problems in one file: an M4A is already compressed
 * and every target costs a generation, while a FLAC is exact and every target
 * is the first compression. Each page below is written from whichever of those
 * two positions applies.
 */

import type { PairCopy } from './types'

export const M4A_FLAC_COPY: Readonly<Record<string, PairCopy>> = {
  'm4a-to-mp3': {
    h1: 'M4A to MP3 for a car stereo that has not been updated since 2006',
    intro:
      'Apple’s M4A is the better format and MP3 is the one that plays everywhere. Older car head units, cheap MP3 players, gym equipment and a good deal of embedded software list MP3 alone. This converts a library that will not play into one that will, at the cost of a second encode.',
    steps: [
      'Add the M4A files, or a whole folder of them.',
      'Choose a bitrate at least as high as the source — 192 kbps is a safe default.',
      'Download the MP3 files, or take the batch as one ZIP.',
    ],
    faq: [
      {
        q: 'How much quality is lost?',
        a: 'A second lossy generation, which is audible on cymbals and applause if you go below the source bitrate and generally not otherwise. Match or exceed the original.',
      },
      {
        q: 'Do the titles and artwork survive?',
        a: 'Title, artist, album and artwork are mapped into ID3 tags, which is what MP3 players read.',
      },
      {
        q: 'Will a purchased iTunes track convert?',
        a: 'Anything bought after 2009 is unprotected AAC and converts normally. Older purchases carry FairPlay protection and cannot be converted at all.',
      },
      {
        q: 'What about an Apple Lossless file?',
        a: 'ALAC also uses the `.m4a` extension, and converting one to MP3 is a first-generation encode — considerably better than converting from AAC.',
      },
    ],
    note: 'The `.m4a` extension covers two entirely different codecs: lossy AAC and lossless ALAC. Nothing in the filename distinguishes them, which is why the same conversion is a quality compromise for one file and not for another.',
  },

  'm4a-to-wav': {
    h1: 'M4A to WAV for editing a voice memo or a recorded interview',
    intro:
      'iPhone voice memos, recorded calls and Apple’s own audio exports are M4A, and audio editors and transcription engines want uncompressed samples. This performs the decode once and writes it plainly, so the recording can be cut, cleaned and analysed without compounding compression.',
    steps: [
      'Add the M4A files, a whole folder at once if you like; nothing leaves your device.',
      'Convert. WAV is uncompressed, so nothing is configurable.',
      'Download and open the result in your editor or transcription tool.',
    ],
    faq: [
      {
        q: 'Does WAV improve the recording?',
        a: 'No. It holds exactly what the AAC decoded to. Its value is that every edit and save from here on is exact.',
      },
      {
        q: 'Why do transcription tools want WAV?',
        a: 'Because it removes a decoder from the equation and any ambiguity about sample rate and channel layout. Several engines accept nothing else.',
      },
      {
        q: 'How large will the file be?',
        a: 'About 10 MB a minute for stereo. A voice memo recorded in mono is half that.',
      },
      {
        q: 'Which sample rate do I get?',
        a: 'The recording’s own, preserved rather than resampled. Voice memos are commonly 44.1 or 48 kHz.',
      },
    ],
    note: 'iOS voice memos are recorded as mono AAC at a low bitrate, which is entirely adequate for speech and produces a WAV half the size of a stereo one. Nothing is gained by converting such a file to stereo on the way out.',
  },

  'm4a-to-ogg': {
    h1: 'M4A to OGG for Linux, games and open-format libraries',
    intro:
      'Ogg carrying Opus is the open web’s audio format, and a lot of Linux tooling, game engines and archival projects prefer it on principle. Converting an M4A means re-encoding AAC as Opus — a real second generation, worth accepting when the format matters more than the last fraction of fidelity.',
    steps: [
      'Drop the M4A files onto the page, or reach for the file picker if you prefer.',
      'Choose a bitrate at or above the source. Opus at 96 kbps holds up against AAC at 128.',
      'Download the OGG output. Nothing is kept here once you close the tab.',
    ],
    faq: [
      {
        q: 'Is Opus better than AAC?',
        a: 'Below about 96 kbps, clearly. Above that the two are close, and the reason to choose Opus is that it is unencumbered rather than that it sounds better.',
      },
      {
        q: 'Does converting improve anything?',
        a: 'Not the sound. You are re-compressing compressed audio, so the result can only match or slightly trail the source.',
      },
      {
        q: 'Will Apple software play an OGG?',
        a: 'iOS 17 and later handle Opus natively; macOS is more mixed. VLC plays it everywhere.',
      },
      {
        q: 'Do the tags survive?',
        a: 'Title, artist and album are mapped into Vorbis comments, which is the tagging scheme an Ogg file uses.',
      },
    ],
    note: 'AAC and Opus overlap in their design goals but not in their history — AAC came out of the MPEG process in 1997, and Opus was assembled at the IETF in 2012 from a speech codec and a music codec bolted together. That hybrid is why Opus is so much better at very low bitrates.',
  },

  'm4a-to-flac': {
    h1: 'M4A to FLAC, lossless from here on and no further back',
    intro:
      'FLAC preserves exactly what it is given, which for an M4A means preserving the AAC compression along with everything else. It is the right conversion when a pipeline requires lossless input, and it is not a way to recover quality — nothing is, whatever a converter promises.',
    steps: [
      'Choose the M4A files you want converted; several at a time is no problem at all.',
      'Convert. FLAC is lossless, so there is no setting that could alter the result.',
      'Download the FLAC files one at a time, or take the whole batch as a single archive.',
    ],
    faq: [
      {
        q: 'Will this improve the audio?',
        a: 'No. The AAC encoder discarded information permanently and no format can put it back. The FLAC will be much larger and sound identical.',
      },
      {
        q: 'When is it worth doing?',
        a: 'When a mastering, broadcast or archival system requires lossless input. Converting satisfies that requirement without pretending to add quality.',
      },
      {
        q: 'What if the M4A is Apple Lossless?',
        a: 'Then this is a genuine lossless-to-lossless conversion — ALAC and FLAC hold the same samples, so nothing at all is lost and the file becomes readable by non-Apple software.',
      },
      {
        q: 'Can I tell afterwards which it was?',
        a: 'From a spectrogram, yes. A FLAC made from AAC shows the encoder’s sharp frequency cutoff; one made from ALAC does not.',
      },
    ],
    note: 'ALAC and FLAC solve the same problem with almost the same technique — linear prediction plus entropy coding of the residual — and Apple open-sourced ALAC in 2011. Converting between them is genuinely lossless in both directions.',
  },

  'flac-to-mp3': {
    h1: 'FLAC to MP3 to fit a lossless library onto a phone',
    intro:
      'A FLAC collection is beautiful and enormous — roughly 30 MB per song. Converting to MP3 for a phone, a car or a portable player is a first-generation encode from a perfect source, which is exactly the situation in which a lossy codec performs best.',
    steps: [
      'Add the FLAC files, or a whole album at a time.',
      'Choose a bitrate. 256 or 320 kbps for a listening copy; 192 kbps if space is tight.',
      'Download the MP3 files, or take the album as one ZIP.',
    ],
    faq: [
      {
        q: 'What bitrate is transparent?',
        a: 'Most listeners cannot distinguish 256 kbps from the source on ordinary equipment. 320 kbps is the ceiling and costs a quarter more for a very small difference.',
      },
      {
        q: 'How much smaller will it be?',
        a: 'About four to six times. A 30 MB FLAC becomes roughly a 7 MB MP3 at 256 kbps.',
      },
      {
        q: 'Should I keep the FLAC files?',
        a: 'Yes. They are the master. Every future format you might want should be encoded from them rather than from the MP3.',
      },
      {
        q: 'Do the tags carry across?',
        a: 'Vorbis comments are mapped to ID3 tags, so titles, artists, albums and artwork appear correctly in an MP3 player.',
      },
    ],
    note: 'Encoding from a lossless source is the one case where a lossy codec is given exactly what it was designed for. An MP3 made from a FLAC is measurably better than one made from another MP3 at the same bitrate, because there are no prior artefacts for it to spend bits preserving.',
  },

  'flac-to-wav': {
    h1: 'FLAC to WAV, the exact same audio for software that will not decode',
    intro:
      'Some audio editors, samplers, DJ tools and older hardware read WAV and nothing else, and will not be argued with. Because FLAC is lossless, this conversion produces byte-identical audio — not an approximation, not a re-encode, simply the same samples with the compression taken off them.',
    steps: [
      'Put the FLAC files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. Both formats hold the same samples, so nothing is decided here.',
      'Download the WAV files and open them in your software.',
    ],
    faq: [
      {
        q: 'Is the audio identical?',
        a: 'Bit for bit. FLAC decoding is exact by definition, and the WAV holds precisely what the FLAC encoded.',
      },
      {
        q: 'Why would software refuse FLAC?',
        a: 'Because it needs a decoder, and a lot of professional and embedded audio software only implements PCM. It is a licensing and simplicity decision rather than a technical limitation.',
      },
      {
        q: 'How much larger is the WAV?',
        a: 'About twice, since FLAC typically compresses to half. The exact ratio depends entirely on the material.',
      },
      {
        q: 'Can I convert back afterwards?',
        a: 'Yes, and the resulting FLAC will decode to the same samples again. Round-tripping between the two costs nothing at all.',
      },
    ],
    note: 'FLAC stores an MD5 checksum of the original uncompressed samples in its header, so a decoder can verify that what it produced is exactly what was encoded. No lossy format has anything comparable, because there would be nothing to compare against.',
  },

  'flac-to-m4a': {
    h1: 'FLAC to M4A for an Apple library at a fraction of the size',
    intro:
      'A FLAC collection is unreadable to Apple Music and far too large for a phone. AAC in an M4A container is the best-quality-per-byte format those applications handle, and encoding from lossless source material is where it performs at its best.',
    steps: [
      'Add the FLAC file you need converted, and wait for it to appear in the list.',
      'Choose a bitrate. 256 kbps AAC is a comfortable listening copy; 128 kbps is ample for a phone.',
      'Download the M4A files and add them to your library.',
    ],
    faq: [
      {
        q: 'Why not just convert to ALAC?',
        a: 'You can, and it stays lossless — but it is also the same size as the FLAC. AAC exists because a phone cannot hold a lossless library.',
      },
      {
        q: 'What bitrate should I use?',
        a: '256 kbps is what Apple uses for its own store, and it is transparent for almost everyone. 128 kbps is noticeably smaller and still good.',
      },
      {
        q: 'Does artwork carry over?',
        a: 'Yes. Embedded pictures in the FLAC are written into the M4A’s metadata, which is what Apple Music displays.',
      },
      {
        q: 'Will these files sound better than MP3?',
        a: 'At the same bitrate, yes. AAC is the newer design and handles transients and high frequencies better.',
      },
    ],
    note: 'Apple’s own store encodes at 256 kbps AAC, and that figure is a deliberate compromise rather than a limit — the codec is transparent for most listeners well below it on most material.',
  },

  'flac-to-ogg': {
    h1: 'FLAC to OGG for game engines and open-format projects',
    intro:
      'Opus inside an Ogg container is the format game engines, Linux packaging and open-web projects reach for, and encoding it from a lossless master is where the codec is at its strongest. Loops are clean, low bitrates hold up, and nothing about the file carries a licence.',
    steps: [
      'Drop in the FLAC files. They stay on this device from the first byte to the last.',
      'Choose a bitrate — 96 kbps for music, 64 for sound effects, 32 for speech.',
      'Download the OGG files and add them to the project.',
    ],
    faq: [
      {
        q: 'Why is Opus so good at low bitrates?',
        a: 'It combines a speech codec and a music transform codec and switches between them per frame. Nothing designed in the 1990s can do that.',
      },
      {
        q: 'Does it loop cleanly?',
        a: 'Yes. Opus records an explicit pre-skip value so the decoder knows exactly what to discard, which is the specific problem that makes MP3 unusable for looping audio.',
      },
      {
        q: 'What bitrate for background music in a game?',
        a: '96 to 128 kbps is transparent for most music and small enough to ship dozens of tracks.',
      },
      {
        q: 'Do tags survive?',
        a: 'Directly. FLAC and Ogg both use Vorbis comments, so the metadata maps across without translation.',
      },
    ],
    note: 'FLAC and Ogg come from the same project family and share the Vorbis comment tagging scheme, which is why metadata moves between them without the field-name mapping that MP3 and M4A both require.',
  },
}
