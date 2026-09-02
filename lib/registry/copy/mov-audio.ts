/**
 * Copy for the four conversions that take the sound out of a MOV.
 *
 * The recordings behind these are voice memos, interviews and lectures filmed
 * on a phone, so the pages lean on speech rather than on music — which is also
 * what makes the bitrate advice different from the MP4 pages.
 */

import type { PairCopy } from './types'

export const MOV_AUDIO_COPY: Readonly<Record<string, PairCopy>> = {
  'mov-to-mp3': {
    h1: 'MOV to MP3, an interview without the picture of the room',
    intro:
      'A lecture, a meeting or an interview filmed on a phone is a very large file containing very little that has to be seen. Extracting the audio to MP3 leaves something a fraction of the size that plays on every device, uploads to every transcription service, and can be listened to without a screen.',
    steps: [
      'Add the MOV files, a whole folder at once if you like; nothing leaves your device.',
      'For speech, choose 96 kbps mono — it is indistinguishable and a quarter the size of a music setting.',
      'Download the MP3 and check that it opens where the original would not.',
    ],
    faq: [
      {
        q: 'What bitrate is right for a recorded meeting?',
        a: '96 kbps is comfortable for speech, and 64 kbps mono is still perfectly intelligible. Reserve 192 kbps and above for music.',
      },
      {
        q: 'How much smaller is the MP3?',
        a: 'Typically ten to twenty times. In a filmed conversation the video track is almost the entire file.',
      },
      {
        q: 'Will transcription services accept it?',
        a: 'Every one of them takes MP3. Some prefer WAV for accuracy, which is the conversion to choose if the recording is difficult.',
      },
      {
        q: 'Does the audio lose quality?',
        a: 'A second lossy generation, since the MOV’s audio is already AAC. On speech at a sensible bitrate it is not audible.',
      },
    ],
    note: 'iPhone video records audio at 44.1 kHz AAC, which maps onto MP3’s sample rates without resampling. That is why this particular extraction is cleaner than the same conversion from a 48 kHz camera file.',
  },

  'mov-to-wav': {
    h1: 'MOV to WAV for transcription software that wants raw samples',
    intro:
      'Speech recognition and audio analysis tools work on uncompressed samples, and several of them refuse anything else outright. Converting a phone recording to WAV gives them exactly that: no codec in the way, no second generation of compression, and no ambiguity about what the file contains.',
    steps: [
      'Drop the MOV files onto the page, or reach for the file picker if you prefer.',
      'Convert. WAV is uncompressed, so there is nothing to configure.',
      'Download and feed it to the transcription or analysis tool.',
    ],
    faq: [
      {
        q: 'Does WAV improve transcription accuracy?',
        a: 'Compared with a heavily compressed MP3, measurably. Compared with the AAC already inside the MOV, barely — but it removes one variable, which is why the tools ask for it.',
      },
      {
        q: 'How big will the file be?',
        a: 'About 10 MB per minute of stereo audio, or 5 MB mono. An hour-long meeting is roughly 600 MB.',
      },
      {
        q: 'Is there a length limit?',
        a: 'WAV headers use 32-bit sizes, so files cap out near 4 GB — about six hours of stereo. Longer recordings should go to FLAC.',
      },
      {
        q: 'Which sample rate do I get?',
        a: 'The recording’s own, preserved rather than resampled. Most speech tools accept whatever they are given and resample internally.',
      },
    ],
    note: 'WAV stores samples with no framing, so a truncated file is still playable up to the point it stops — which is why recovery tools and forensic workflows prefer it to any compressed format.',
  },

  'mov-to-m4a': {
    h1: 'MOV to M4A, taking the audio out with nothing re-encoded',
    intro:
      'An iPhone video stores its sound as AAC, and an M4A is AAC in the same family of container. Extracting to M4A therefore copies the audio stream across untouched — no decode, no re-encode, no second generation of loss, and a conversion that finishes as fast as the file can be read.',
    steps: [
      'Choose the MOV files you want converted; several at a time is no problem at all.',
      'Convert. The AAC stream is copied rather than re-compressed.',
      'Download the M4A and add it to your music or podcast library.',
    ],
    faq: [
      {
        q: 'Is the audio genuinely unchanged?',
        a: 'Yes. The compressed stream is moved into a new container without being decoded, so the result is bit-identical to the audio inside the MOV.',
      },
      {
        q: 'Why not extract to MP3 instead?',
        a: 'Because MP3 requires decoding the AAC and re-compressing it, which loses a little every time. Choose MP3 only when the destination cannot play M4A.',
      },
      {
        q: 'Will it sync to an iPhone?',
        a: 'Natively. M4A is Apple’s own audio convention and appears in Music and Podcasts without any conversion step.',
      },
      {
        q: 'Can I add artwork and tags afterwards?',
        a: 'Yes — M4A is a full container with proper metadata support, unlike a bare AAC stream.',
      },
    ],
    note: 'Because both formats are ISO base media containers, this extraction rewrites only the track table and the header boxes. It is the same mechanism that makes MOV to MP4 instant, applied to the audio track alone.',
  },

  'mov-to-aac': {
    h1: 'MOV to AAC for a pipeline that wants the stream and nothing else',
    intro:
      'A bare `.aac` file is the audio stream with a small header on every frame and no container at all. Broadcast encoders, streaming ingest pipelines and some embedded players expect exactly that shape. It is a specialist target — for listening, M4A carries the same audio with tags and an index.',
    steps: [
      'Put the MOV files in the queue. Large ones are fine, because nothing is uploaded.',
      'Convert. The audio is written as an ADTS stream.',
      'Download and hand it to the system that asked for it.',
    ],
    faq: [
      {
        q: 'Why would I want a raw AAC file?',
        a: 'Because it can be cut and concatenated at any frame boundary without rewriting an index, which is what streaming and broadcast pipelines are built around.',
      },
      {
        q: 'Can it hold cover art or a title?',
        a: 'No. There is no container, so there is nowhere to put metadata. Use M4A if any of that matters.',
      },
      {
        q: 'Will seeking work properly?',
        a: 'Approximately. Without an index a player estimates position from the bitrate, which is accurate on constant-bitrate material and vague on variable.',
      },
      {
        q: 'How does the quality compare with M4A?',
        a: 'The audio is identical, because both hold the same AAC stream. The difference is entirely in the packaging around it.',
      },
    ],
    note: 'Every ADTS frame repeats a seven-byte header describing the sample rate, channel configuration and profile, so a decoder can start anywhere in the file. That redundancy costs under one percent and buys the format its whole reason to exist.',
  },
}
