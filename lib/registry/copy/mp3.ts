/**
 * Copy for the five conversions that start from an MP3.
 *
 * Everything here is a second lossy generation or a needless expansion, and the
 * pages say so — an MP3 is already compressed, and no target can put back what
 * it discarded. Each page is honest about which of the two it is and when it is
 * still worth doing.
 */

import type { PairCopy } from './types'

export const MP3_COPY: Readonly<Record<string, PairCopy>> = {
  'mp3-to-wav': {
    h1: 'MP3 to WAV so an audio editor will take the file',
    intro:
      'Audio editors, samplers, transcription engines and analysis tools work on uncompressed samples and several refuse anything else. This decodes the MP3 once and writes the result plainly, which is what those tools expect and what keeps every subsequent edit and save exact.',
    steps: [
      'Put the MP3 files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. WAV is uncompressed, so there is nothing to configure.',
      'Download and open the result in your editor.',
    ],
    faq: [
      {
        q: 'Does this improve the sound quality?',
        a: 'Not at all. The WAV holds exactly what the MP3 decoded to, artefacts included. What it gives you is a file that does not degrade any further through editing.',
      },
      {
        q: 'Why is the WAV ten times bigger?',
        a: 'Because it stores every sample literally. A 128 kbps MP3 is about 1 MB a minute; the same audio as WAV is about 10 MB a minute regardless of what it sounds like.',
      },
      {
        q: 'Should I keep the WAV afterwards?',
        a: 'Only while you are working on it. Once the edits are finished, save the result as FLAC to archive it or back to MP3 to distribute it.',
      },
      {
        q: 'Is there a length limit?',
        a: 'WAV headers use 32-bit sizes, so it becomes unreliable near 4 GB — about six hours of stereo audio.',
      },
    ],
    note: 'MP3 decoding is not exactly reproducible: the specification defines the decoder loosely enough that two implementations can produce marginally different samples. Two WAVs made from the same MP3 by different tools will therefore not be byte-identical, and both are correct.',
  },

  'mp3-to-m4a': {
    h1: 'MP3 to M4A for an Apple library that prefers AAC',
    intro:
      'iTunes, Apple Music and the iOS Files app all handle MP3, and all of them prefer AAC — better sound at the same bitrate, proper chapter support, and consistent metadata. Converting an older collection is worth doing when file size matters more than the small cost of a second encode.',
    steps: [
      'Add the MP3 files, or a whole folder of them.',
      'Choose a bitrate at least equal to the source, so the second generation stays quiet.',
      'Download the M4A files and add them to your library.',
    ],
    faq: [
      {
        q: 'Is it worth converting an existing MP3 collection?',
        a: 'Usually not for quality — you would be re-compressing already compressed audio. It is worth it when a device or app handles AAC better, or when you need the smaller file at the same perceived quality.',
      },
      {
        q: 'What bitrate should I pick?',
        a: 'The same as the source or higher. AAC at 128 kbps genuinely does match MP3 at 192, but only when encoding from an unspoiled original.',
      },
      {
        q: 'Do the tags carry across?',
        a: 'Title, artist and album are mapped from the ID3 tags into M4A’s own metadata, which is the format Apple software reads.',
      },
      {
        q: 'Will an M4A play on Android?',
        a: 'Yes. AAC support is universal on Android and has been for well over a decade.',
      },
    ],
    note: 'AAC was designed by many of the same people as MP3 and fixes its specific weaknesses — a better filter bank, more window shapes, no fixed frame boundaries. That is why the same bitrate genuinely does sound better rather than merely being newer.',
  },

  'mp3-to-ogg': {
    h1: 'MP3 to OGG for games, Linux and licence-free distribution',
    intro:
      'Game engines, Linux distributions and open-web projects standardise on Ogg because it carries no patent obligations. Converting an MP3 re-encodes it as Opus inside an Ogg container — a real second generation, and worth it when the licensing question matters more than the last percent of fidelity.',
    steps: [
      'Add the MP3 file you need converted, and wait for it to appear in the list.',
      'Choose a bitrate. Opus at 96 kbps is comfortably better than MP3 at 128.',
      'Download the OGG. It is ready the moment the job reports that it has finished.',
    ],
    faq: [
      {
        q: 'Why do game engines prefer Ogg?',
        a: 'Because it is royalty-free, it decodes cheaply, and it seeks and loops reliably — all four of which matter when audio is triggered thousands of times in a session.',
      },
      {
        q: 'Is Opus better than MP3?',
        a: 'Substantially, at every bitrate. It is twenty-five years newer and was designed for both speech and music, which MP3 was not.',
      },
      {
        q: 'Does converting improve the sound?',
        a: 'No. You are re-encoding compressed audio, so it can only stay the same or get slightly worse. The gain is the format, not the fidelity.',
      },
      {
        q: 'Will it play on an iPhone?',
        a: 'iOS 17 and later, natively. Before that, only in players bundling their own decoder such as VLC.',
      },
    ],
    note: 'Ogg is a container and Opus is the codec inside it — a distinction that matters here because older Ogg files carry Vorbis instead. Both are royalty-free; Opus is the one still being deployed.',
  },

  'mp3-to-flac': {
    h1: 'MP3 to FLAC, and why it will not improve anything',
    intro:
      'FLAC is lossless, so a FLAC made from an MP3 preserves the MP3 exactly — including everything the MP3 already threw away. It is the right conversion for a workflow that requires lossless input, and it is not a way to recover quality. Nothing is, and any tool that suggests otherwise is wrong.',
    steps: [
      'Drop in the MP3 files. They stay on this device from the first byte to the last.',
      'Convert. FLAC is lossless, so there is no setting that could change the result.',
      'Collect the FLAC files from the results panel below, individually or all together.',
    ],
    faq: [
      {
        q: 'Will this make my MP3 sound better?',
        a: 'No. The detail MP3 discarded is not in the file to recover. The FLAC will be several times larger and will sound exactly the same.',
      },
      {
        q: 'Then why would anyone do it?',
        a: 'Because some mastering, broadcast and archival pipelines only accept lossless input. Converting satisfies the requirement without claiming to improve anything.',
      },
      {
        q: 'How much bigger will the file be?',
        a: 'Typically four to six times the MP3. FLAC compresses the decoded audio by about half, and the decoded audio is roughly ten times the MP3.',
      },
      {
        q: 'Can I tell a FLAC made from an MP3 apart from a real one?',
        a: 'Yes, by looking at the frequency spectrum: MP3 encoders cut everything above a sharp ceiling, and that cliff survives into the FLAC. It is how transcodes are spotted.',
      },
    ],
    note: 'MP3 encoders apply a low-pass filter — commonly at 16 kHz for 128 kbps — and the result is a visible cliff in a spectrogram. Since FLAC preserves the signal exactly, the cliff is preserved too, which is why a lossless file made from a lossy one is trivial to identify.',
  },

  'mp3-to-aac': {
    h1: 'MP3 to AAC as a raw stream for a broadcast pipeline',
    intro:
      'A bare `.aac` file is audio frames with a small header on each and no container. Streaming ingest, broadcast encoders and some embedded players want precisely that shape. This re-encodes an MP3 into it, which is a second lossy pass and only worth doing when the pipeline demands the format.',
    steps: [
      'Select the MP3 files, either by dropping them here or by pasting from the clipboard.',
      'Set a bitrate at or above the source to keep the second generation quiet.',
      'Download the AAC and check that it opens where the original would not.',
    ],
    faq: [
      {
        q: 'Should I use this or M4A?',
        a: 'M4A for anything you will listen to or file in a library. A raw stream only for systems that specifically ask for one.',
      },
      {
        q: 'Do the ID3 tags survive?',
        a: 'No. There is no container to hold them, so title, artist and artwork are all dropped.',
      },
      {
        q: 'Is the quality worse than the MP3?',
        a: 'Slightly, because it is a second lossy encode. Matching or exceeding the source bitrate keeps it inaudible on most material.',
      },
      {
        q: 'Which AAC profile is written?',
        a: 'AAC-LC, the profile every decoder supports. The high-efficiency profiles do better at very low bitrates and are far less universally handled.',
      },
    ],
    note: 'ADTS frames repeat a seven-byte header, so a decoder can start anywhere in the file. MP3 frames have the same property, which is why both formats can be cut with a text editor and neither needs an index to be playable.',
  },
}
