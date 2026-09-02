/**
 * Copy for the five conversions that start from a WAV.
 *
 * A WAV is a working file — a recording, a master, an export from an editor —
 * so every page here is about publishing it: the first compression it has been
 * through, and the choice of what to give up.
 */

import type { PairCopy } from './types'

export const WAV_COPY: Readonly<Record<string, PairCopy>> = {
  'wav-to-mp3': {
    h1: 'WAV to MP3, ten megabytes a minute down to one',
    intro:
      'A WAV recording is roughly 10 MB a minute, which is unshareable by email, slow to upload and impractical on a phone. MP3 is the first compression most recordings go through, and because the source is uncompressed there is no second generation to worry about — just one clean encode.',
    steps: [
      'Add the WAV files from your recorder or editor.',
      'Choose a bitrate. 192 kbps is transparent for music; 96 kbps mono is plenty for speech.',
      'Download the MP3 files, or take the batch as one ZIP.',
    ],
    faq: [
      {
        q: 'What bitrate should I use?',
        a: '192 kbps for music and 320 kbps if the recording is a master. For an interview or a lecture, 96 kbps mono is indistinguishable and a fifth of the size.',
      },
      {
        q: 'How much smaller will the file be?',
        a: 'About ten times at 128 kbps and roughly seven at 192. An hour of stereo audio drops from around 600 MB to under 60.',
      },
      {
        q: 'Is quality lost?',
        a: 'Yes, but only once. The WAV is uncompressed, so this is the first and only lossy step, which is the best position to be encoding from.',
      },
      {
        q: 'Should I keep the WAV?',
        a: 'Keep it if it is a master. Every future format you might need is better made from the WAV than from the MP3.',
      },
    ],
    note: 'MP3 supports a fixed set of sample rates, and 48 kHz recordings from video equipment are among them — but 96 kHz and 192 kHz studio rates are not, so those are resampled downward on the way in.',
  },

  'wav-to-m4a': {
    h1: 'WAV to M4A for a smaller file at the same perceived quality',
    intro:
      'AAC in an M4A container is the modern equivalent of an MP3 and beats it at every bitrate — noticeably so below 128 kbps. For a recording being published to Apple platforms, podcast feeds or a phone library, it is the format that gives the most quality for the fewest bytes.',
    steps: [
      'Add the WAV files you want changed. The queue will take as many as you have.',
      'Choose a bitrate. 128 kbps AAC is roughly equivalent to 192 kbps MP3.',
      'Save the M4A result, and delete the original afterwards if you no longer need it.',
    ],
    faq: [
      {
        q: 'Is AAC really better than MP3?',
        a: 'Yes, particularly at lower bitrates. AAC has a better filter bank and more flexible block switching, which is exactly what MP3 handles worst on transients.',
      },
      {
        q: 'What bitrate for a podcast?',
        a: '64 kbps mono for speech, or 96 kbps if there is music in the intro. Both are far smaller than the MP3 setting that would sound the same.',
      },
      {
        q: 'Can I add artwork and chapters?',
        a: 'M4A supports both, which is one of the reasons podcast tooling has moved to it. This conversion writes the audio; tagging is done afterwards.',
      },
      {
        q: 'Will it play everywhere?',
        a: 'On everything made in the last fifteen years. Some very old car stereos and cheap players list MP3 only.',
      },
    ],
    note: 'AAC has no fixed frame size in the way MP3 does, so it can switch to short blocks precisely where a transient occurs. That is why a snare drum or a hand clap survives AAC compression noticeably better.',
  },

  'wav-to-ogg': {
    h1: 'WAV to OGG for game audio and royalty-free distribution',
    intro:
      'Game engines, Linux packaging and open-web projects standardise on Ogg because using it costs nothing and requires no licence. Encoding directly from a WAV means the Opus inside it is a first-generation compression, which is where the codec is at its considerable best.',
    steps: [
      'Bring in the WAV files. There is no sign-up, no upload and no size limit to work around.',
      'Choose a bitrate — Opus at 96 kbps is comfortably transparent for most material.',
      'Download the OGG files and drop them into your project.',
    ],
    faq: [
      {
        q: 'Why do game engines want Ogg?',
        a: 'It is royalty-free, decodes cheaply enough to run hundreds of simultaneous sounds, and loops cleanly — which MP3 famously does not, because of the padding at the start of every file.',
      },
      {
        q: 'What bitrate for sound effects?',
        a: '64 to 96 kbps is ample for short effects. Music beds benefit from 128, and speech is fine as low as 32.',
      },
      {
        q: 'Does Opus loop seamlessly?',
        a: 'Yes, when the encoder writes the correct pre-skip value — which it does here. That is the specific problem that makes MP3 unsuitable for looping game audio.',
      },
      {
        q: 'Is Opus good at low bitrates?',
        a: 'It is the best available. At 48 kbps it comfortably outperforms MP3 at twice that, which is why it took over voice chat entirely.',
      },
    ],
    note: 'MP3 files carry encoder padding at both ends that no MP3 decoder can identify reliably, which produces an audible gap when a file loops. Opus stores an explicit pre-skip count, so the decoder knows exactly what to discard — the reason game audio moved to it.',
  },

  'wav-to-flac': {
    h1: 'WAV to FLAC, half the size and not one sample different',
    intro:
      'FLAC compresses audio losslessly to roughly half the size of a WAV, and decoding it reproduces the original samples bit for bit. For archiving recordings, masters or a CD collection it is the obvious answer: the same audio, half the storage, and proper support for tags a WAV has no room for.',
    steps: [
      'Add the WAV files you are archiving.',
      'Convert. FLAC is lossless, so there is nothing to trade away.',
      'Grab the FLAC from the results list, which appears as soon as the first job lands.',
    ],
    faq: [
      {
        q: 'Is any quality lost?',
        a: 'None. Decoding a FLAC produces exactly the samples the WAV held — it is verifiable by comparing checksums of the decoded output.',
      },
      {
        q: 'How much space does it save?',
        a: 'Forty to sixty percent, depending on the material. Speech and sparse recordings compress best; dense, loud music compresses least.',
      },
      {
        q: 'Can I go back to WAV later?',
        a: 'Whenever you like, and the result will be identical. That reversibility is the entire point of a lossless format.',
      },
      {
        q: 'Does FLAC hold tags?',
        a: 'Yes — artist, album, artwork and arbitrary fields, which WAV has no standard place for. That alone makes it better than WAV for a library.',
      },
    ],
    note: 'FLAC predicts each sample from the ones before it and stores only the residual, then codes the residuals with Rice coding. Both stages are exactly invertible, which is what makes the format lossless rather than merely high quality.',
  },

  'wav-to-aac': {
    h1: 'WAV to AAC, a raw stream for encoders and ingest pipelines',
    intro:
      'Broadcast encoders, streaming ingest and some embedded players expect a bare ADTS stream: audio frames with a header on each and no container around them. Encoding straight from a WAV means the AAC is first-generation, which is the cleanest input such a pipeline can be given.',
    steps: [
      'Load the WAV files into the queue, in whatever order you would like them handled.',
      'Set the bitrate the receiving system expects.',
      'Download the `.aac` stream and hand it over.',
    ],
    faq: [
      {
        q: 'How is this different from M4A?',
        a: 'The audio is identical. A `.aac` file has no container, so no index and no metadata — which is what lets it be cut and joined at any frame.',
      },
      {
        q: 'Should I use this for listening?',
        a: 'No. Use M4A, which holds the same audio plus tags and a seek index.',
      },
      {
        q: 'Which profile is produced?',
        a: 'AAC-LC, supported by every decoder. The high-efficiency profiles do better below 64 kbps and are much less widely handled.',
      },
      {
        q: 'What bitrate does broadcast usually want?',
        a: 'It varies by system, and 128 kbps stereo is a common baseline. Ask the receiving end rather than guessing.',
      },
    ],
    note: 'Because every ADTS frame repeats its own header, a raw AAC stream can be concatenated with another simply by joining the bytes. Container formats need their indexes rebuilt for the same operation, which is the whole reason broadcast pipelines avoid them.',
  },
}
