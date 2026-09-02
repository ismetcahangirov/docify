/**
 * Copy for the eight conversions that start from an OGG or a bare AAC stream.
 *
 * Both sources arrive by accident rather than by choice — an Ogg from a game,
 * a wiki or a Linux tool, a raw AAC from a stream capture — so every page here
 * is written for somebody who has a file their software will not open and did
 * not ask for.
 */

import type { PairCopy } from './types'

export const OGG_AAC_COPY: Readonly<Record<string, PairCopy>> = {
  'ogg-to-mp3': {
    h1: 'OGG to MP3 because almost nothing outside Linux plays an Ogg',
    intro:
      'Ogg files turn up from games, Wikipedia, Linux tooling and voice recorders, and then a car stereo, a phone app or a piece of editing software refuses them. MP3 is the way out: the same recording in the one audio format nothing has ever declined.',
    steps: [
      'Select the OGG files, either by dropping them here or by pasting from the clipboard.',
      'Choose a bitrate at or above the source — 192 kbps is a safe default.',
      'Save the MP3 results. Each has its own link, and a batch has one archive as well.',
    ],
    faq: [
      {
        q: 'Why will my player not open an Ogg?',
        a: 'Because it would need a Vorbis or Opus decoder, and consumer hardware has generally only ever licensed MP3 and AAC. The format is fine; the player has never met it.',
      },
      {
        q: 'Is quality lost?',
        a: 'A second lossy generation, yes. Opus and Vorbis are efficient, so a 96 kbps Ogg carries real detail — encode the MP3 at 192 kbps or above so it survives.',
      },
      {
        q: 'Will the MP3 be bigger?',
        a: 'Usually, and often by a lot. MP3 needs roughly twice the bitrate of Opus for the same perceived quality.',
      },
      {
        q: 'Do the tags carry across?',
        a: 'Vorbis comments are mapped into ID3 tags, so title, artist and album appear in an MP3 player.',
      },
    ],
    note: 'Ogg is a container and the codec inside it can be Vorbis, Opus, Speex or FLAC. Software that plays one Ogg and refuses another is missing a codec, not the container — which is the single most confusing thing about the format.',
  },

  'ogg-to-wav': {
    h1: 'OGG to WAV for editors that have no Vorbis decoder',
    intro:
      'Audio editors, samplers and analysis tools frequently have no Ogg support at all, because implementing Vorbis and Opus is work nobody did for a format their users rarely brought them. Converting to WAV decodes it once and hands the software exactly what it expects.',
    steps: [
      'Add the OGG files you want changed. The queue will take as many as you have.',
      'Convert. WAV is uncompressed, so nothing is configurable.',
      'Download and open the result in your editor.',
    ],
    faq: [
      {
        q: 'Is any quality lost?',
        a: 'None in this step. The WAV holds exactly what the decoder produced; whatever the original encode discarded was already gone.',
      },
      {
        q: 'What sample rate will I get?',
        a: 'Opus always decodes at 48 kHz whatever it was fed, so an Opus-in-Ogg file becomes a 48 kHz WAV. Vorbis preserves its own rate.',
      },
      {
        q: 'How large will the file be?',
        a: 'About 10 MB a minute for stereo, which is typically ten to twenty times the Ogg.',
      },
      {
        q: 'Can I edit and go back to Ogg?',
        a: 'Yes, though that re-encode is a second lossy generation. Keep the edits in WAV until the very last step.',
      },
    ],
    note: 'Ogg pages carry a CRC checksum and a granule position, so a decoder can resynchronise after damage and still know where it is in the stream. That resilience is why the format was adopted for internet radio, and it survives into nothing about the WAV.',
  },

  'ogg-to-m4a': {
    h1: 'OGG to M4A so an Apple library will finally index the file',
    intro:
      'Apple Music, iTunes and the iOS Files app do not recognise Ogg at any level — the files simply do not appear. Converting to M4A re-encodes the audio as AAC and puts it in the container Apple software indexes, with the artwork and titles it expects to display.',
    steps: [
      'Bring in the OGG files. There is no sign-up, no upload and no size limit to work around.',
      'Choose a bitrate at or above the source — 128 kbps AAC is a reasonable floor.',
      'Download the M4A files and add them to your library.',
    ],
    faq: [
      {
        q: 'Is the audio re-encoded?',
        a: 'Yes. Opus and Vorbis cannot live inside an M4A, so the audio is decoded and re-compressed as AAC.',
      },
      {
        q: 'How much quality is lost?',
        a: 'One extra generation. Matching or exceeding the source bitrate keeps it inaudible on most material, and going below it will not.',
      },
      {
        q: 'Will the metadata survive?',
        a: 'Titles, artists and albums are mapped from Vorbis comments into M4A metadata, which is what Apple software reads.',
      },
      {
        q: 'Is AAC better than Opus?',
        a: 'Below about 96 kbps, no — Opus is clearly ahead. This conversion is about compatibility, not quality.',
      },
    ],
    note: 'Vorbis comments are free-form key-value pairs and M4A metadata is a fixed set of typed atoms, so unusual fields have nowhere to go. Standard tags map cleanly; anything custom is dropped in the translation.',
  },

  'ogg-to-flac': {
    h1: 'OGG to FLAC when a pipeline demands lossless input',
    intro:
      'FLAC preserves exactly what it receives, which from an Ogg means preserving the Vorbis or Opus compression too. It satisfies a system that requires lossless input and improves nothing at all — there is no way to recover what a lossy encoder discarded, and no converter can offer one.',
    steps: [
      'Load the OGG files into the queue, in whatever order you would like them handled.',
      'Convert. FLAC is lossless, so no setting could change the outcome.',
      'Download the finished FLAC and carry on with whatever needed it in the first place.',
    ],
    faq: [
      {
        q: 'Will the audio improve?',
        a: 'No. The FLAC will be several times larger and will sound exactly like the Ogg it came from.',
      },
      {
        q: 'Why do it at all?',
        a: 'Because some mastering, broadcast and archival systems accept lossless input only. This meets that requirement honestly.',
      },
      {
        q: 'How much bigger will the file be?',
        a: 'Typically five to ten times, depending on the Ogg’s bitrate. FLAC halves the decoded audio, and the decoded audio is very large.',
      },
      {
        q: 'What if the Ogg already contains FLAC?',
        a: 'Then it genuinely is lossless, and this is a container change with nothing given up. Ogg can carry FLAC, though the native `.flac` file is far more common.',
      },
    ],
    note: 'FLAC exists in two packagings: native FLAC files, and FLAC inside an Ogg container for streaming. The audio is identical; only the framing differs, which is why the same codec appears on both sides of this conversion.',
  },

  'aac-to-mp3': {
    h1: 'AAC to MP3 for players that will not touch a bare stream',
    intro:
      'A raw `.aac` file is an audio stream with no container, and a great many players either refuse it or handle it badly — no duration, no seeking, no title. Converting to MP3 produces something every player understands completely, at the cost of a second encode.',
    steps: [
      'Add the AAC files, a whole folder at once if you like; nothing leaves your device.',
      'Choose a bitrate at or above the source, so the second generation stays quiet.',
      'Take the MP3 output from the results panel once the queue has finished working.',
    ],
    faq: [
      {
        q: 'Why does my player show no duration?',
        a: 'Because a bare AAC stream has no index and no header describing its length. The player is estimating, and often getting it wrong.',
      },
      {
        q: 'Would M4A be a better target?',
        a: 'For quality, yes — the audio could be repackaged without re-encoding. Choose MP3 only when the destination cannot play AAC in any container.',
      },
      {
        q: 'Is the quality worse?',
        a: 'Slightly, because this is a decode and a re-encode. Matching the source bitrate makes it very hard to hear.',
      },
      {
        q: 'Where do bare AAC files come from?',
        a: 'Stream captures, broadcast tooling and some voice recorders. Almost nothing produces them deliberately as a listening format.',
      },
    ],
    note: 'ADTS frames repeat a header every frame, so a bare AAC file is roughly half a percent larger than the same audio in an M4A. That overhead buys the ability to start decoding from any point, which is what a broadcast stream needs and a file does not.',
  },

  'aac-to-wav': {
    h1: 'AAC to WAV for editing a capture that has no container',
    intro:
      'A raw AAC stream is awkward to edit: no reliable duration, imprecise seeking, and no metadata to work from. Decoding it to WAV gives an editor a file with an exact length and sample-accurate positioning, which is the difference between working on a capture and fighting it.',
    steps: [
      'Drop the AAC files onto the page, or reach for the file picker if you prefer.',
      'Convert. WAV is uncompressed, so nothing needs deciding.',
      'Download and open it in your editor.',
    ],
    faq: [
      {
        q: 'Why is seeking so unreliable in the AAC?',
        a: 'There is no index. A player estimates position from the bitrate, which is accurate on constant-bitrate material and vague on anything variable.',
      },
      {
        q: 'Is the decode exact?',
        a: 'The WAV holds exactly what the AAC decoder produced. The compression that happened earlier is permanent and unaffected either way.',
      },
      {
        q: 'How large will the WAV be?',
        a: 'About 10 MB a minute for stereo — typically ten times the AAC.',
      },
      {
        q: 'What sample rate do I get?',
        a: 'The stream’s own, read from its ADTS headers. Broadcast captures are usually 48 kHz and music captures 44.1.',
      },
    ],
    note: 'Every ADTS header states the sample rate and channel configuration, so a decoder can work out the format from any frame in the file. That is what makes a raw stream recoverable when the first few seconds are missing.',
  },

  'aac-to-m4a': {
    h1: 'AAC to M4A, the same audio with an index and a title',
    intro:
      'This is the cheapest fix available for a bare AAC stream: the audio moves into an MP4 container untouched, gaining an index, a reliable duration and somewhere to put a title and artwork. Nothing is decoded and nothing is re-encoded, so the sound is identical.',
    steps: [
      'Choose the AAC files you want converted; several at a time is no problem at all.',
      'Convert. The audio stream is copied into the container as it is.',
      'Download the M4A and add it to your library.',
    ],
    faq: [
      {
        q: 'Is the audio unchanged?',
        a: 'Completely. The compressed frames are moved into a container without being decoded, so this is lossless in the strictest sense.',
      },
      {
        q: 'What do I actually gain?',
        a: 'A seek index, an accurate duration, metadata support, and recognition by every music library that ignores a bare stream.',
      },
      {
        q: 'Will the file be smaller?',
        a: 'Marginally. The per-frame ADTS headers are replaced by a single index, which saves about half a percent.',
      },
      {
        q: 'Should I ever prefer the raw stream?',
        a: 'Only in a pipeline that cuts and joins audio at frame boundaries. For anything you listen to, M4A is strictly better.',
      },
    ],
    note: 'An M4A stores frame sizes in a table at the front of the file rather than in a header on each frame, which is why seeking is exact and why the container can be a few kilobytes smaller than the stream it holds.',
  },

  'aac-to-ogg': {
    h1: 'AAC to OGG for open-format projects and Linux tooling',
    intro:
      'Projects that avoid patent-encumbered codecs on principle — Linux distributions, game engines, open-web archives — want Ogg. Converting a bare AAC stream re-encodes it as Opus inside that container, which is a genuine second generation and the price of the format change.',
    steps: [
      'Put the AAC files in the queue. Large ones are fine, because nothing is uploaded.',
      'Choose a bitrate at or above the source. Opus at 96 kbps stands up well against AAC at 128.',
      'Download the OGG. It is ready the moment the job reports that it has finished.',
    ],
    faq: [
      {
        q: 'Why not keep the AAC?',
        a: 'Because AAC carries patent licensing that Opus does not. For a project that has made that a requirement, it is the whole reason to convert.',
      },
      {
        q: 'Is Opus better than AAC?',
        a: 'At low bitrates, clearly. Above about 128 kbps the two are close enough that the choice comes down to licensing and support.',
      },
      {
        q: 'How much quality is lost?',
        a: 'One generation. Encode at or above the source bitrate and it is very hard to hear on most material.',
      },
      {
        q: 'Will the duration be right this time?',
        a: 'Yes. Ogg pages carry granule positions, so the container knows exactly how long the stream is — which a bare AAC file never did.',
      },
    ],
    note: 'Opus was standardised by the IETF rather than by MPEG, specifically so that it could be published with a royalty-free licence and an open reference implementation. That procedural difference, not a technical one, is what this conversion is usually about.',
  },
}
