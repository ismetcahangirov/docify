/**
 * Copy for the six conversions that take the sound out of an MP4.
 *
 * The picture is discarded in all six, so what separates the pages is what the
 * sound is *for*: something to listen to, something to transcribe, something to
 * archive, something to edit. Each target answers one of those.
 */

import type { PairCopy } from './types'

export const MP4_AUDIO_COPY: Readonly<Record<string, PairCopy>> = {
  'mp4-to-mp3': {
    h1: 'MP4 to MP3, the soundtrack without the video attached',
    intro:
      'A lecture, an interview, a podcast recorded on camera or a piece of music from a video — all of them are audio wrapped in a picture nobody needs. Extracting to MP3 leaves a file a fraction of the size that plays on every phone, car stereo and speaker ever made.',
    steps: [
      'Add the MP4 or the video file you want the sound from.',
      'Choose a bitrate. 192 kbps is transparent for music; 96 kbps is ample for speech and halves the file again.',
      'Take the MP3 output from the results panel once the queue has finished working.',
    ],
    faq: [
      {
        q: 'How much smaller will the MP3 be?',
        a: 'Usually between five and twenty times, because the video track is almost all of the original file. An hour-long lecture typically drops from several hundred megabytes to around thirty.',
      },
      {
        q: 'Does the audio quality drop?',
        a: 'Slightly. The MP4’s audio is already compressed, usually as AAC, and MP3 is a second lossy pass. At 192 kbps that second generation is very hard to hear; at 64 kbps it is obvious.',
      },
      {
        q: 'What bitrate should I use for speech?',
        a: '96 kbps mono is plenty for a voice recording and produces a file about a quarter the size of a stereo music setting.',
      },
      {
        q: 'Can I keep the video too?',
        a: 'The original is untouched — nothing is modified in place. The conversion produces a new audio file beside it.',
      },
    ],
    note: 'MP3 is limited to two channels and to a fixed set of sample rates, so a video with 5.1 surround is downmixed to stereo on the way out. That downmix is the one part of this conversion that changes what you hear rather than how well it is encoded.',
  },

  'mp4-to-wav': {
    h1: 'MP4 to WAV for editing, transcription and analysis software',
    intro:
      'Audio editors, transcription engines and speech-analysis tools want uncompressed PCM, because every compressed format has to be decoded before anything can be done to it. WAV is that decode, written to disk: no further loss, no codec to argue about, and roughly ten megabytes a minute.',
    steps: [
      'Add the MP4 whose audio you need to work on.',
      'Convert. WAV is uncompressed, so there is no quality setting.',
      'Download and open it in your editor or transcription tool.',
    ],
    faq: [
      {
        q: 'Is the WAV better quality than the MP4’s audio?',
        a: 'No. It is exactly what the AAC decoded to. What it gives you is a guarantee that nothing further degrades through however many edits and saves come next.',
      },
      {
        q: 'Why is the file so large?',
        a: 'It stores every sample literally — about 10 MB per minute of stereo audio at CD rate. That size is why it is a working format rather than a delivery one.',
      },
      {
        q: 'Which sample rate do I get?',
        a: 'The source’s own, preserved rather than resampled. Video audio is usually 48 kHz, which is what most transcription tools expect anyway.',
      },
      {
        q: 'Is there a file size limit?',
        a: 'WAV’s header uses 32-bit lengths, so it caps out around 4 GB — roughly six hours of stereo. Longer recordings need FLAC.',
      },
    ],
    note: 'A WAV file is a RIFF container with a header describing the sample rate, channel count and bit depth, followed by the samples themselves. There is no decoding step at all, which is precisely why editing software prefers it.',
  },

  'mp4-to-m4a': {
    h1: 'MP4 to M4A, the audio out with no second generation of loss',
    intro:
      'The sound in an MP4 is almost always AAC, and an M4A is AAC in the same container with the picture removed. Extracting to M4A therefore costs nothing at all — the audio stream is copied across untouched, which no conversion to MP3 or WAV can claim.',
    steps: [
      'Add the MP4 file you need converted, and wait for it to appear in the list.',
      'Convert. The AAC stream is copied straight across, with no encoder anywhere in the path.',
      'Download the M4A, which will play in Apple Music, iTunes and every modern player.',
    ],
    faq: [
      {
        q: 'Is this really lossless?',
        a: 'For the extraction, yes. The AAC stream inside the MP4 is written into the M4A unchanged, so what you get is bit-identical to the audio you had.',
      },
      {
        q: 'Why choose M4A over MP3?',
        a: 'Because it avoids a second lossy encode entirely. Converting the same audio to MP3 means decoding the AAC and re-compressing it, which is a real if small quality cost.',
      },
      {
        q: 'Will an M4A play in my car?',
        a: 'Most systems made after about 2010 handle it. Older ones and some cheap players list MP3 only, which is the case where the second generation is worth paying.',
      },
      {
        q: 'What if the soundtrack is not AAC?',
        a: 'Then the extraction stops and says so. A television capture or a DVD rip often carries AC-3 instead, which an M4A cannot hold — those files convert to MP3 or WAV, where the audio is re-encoded rather than copied.',
      },
      {
        q: 'What is the difference between M4A and MP4?',
        a: 'None structurally. The extension is a convention that says "there is no video track in here", so players and libraries treat it as music rather than film.',
      },
    ],
    note: 'MP4 and M4A are the same ISO base media container with different extensions, which is why this extraction can be a pure stream copy. Apple introduced the `.m4a` convention so that iTunes could tell audio from video without opening the file.',
  },

  'mp4-to-aac': {
    h1: 'MP4 to AAC, a bare audio stream with no container around it',
    intro:
      'A raw `.aac` file is the audio stream on its own, framed for streaming rather than wrapped in a container. Broadcast encoders, some embedded players and a number of streaming pipelines want exactly that. For ordinary listening M4A is the better target; for feeding a pipeline, this is.',
    steps: [
      'Drop in the MP4 files. They stay on this device from the first byte to the last.',
      'Convert. The audio is written as an ADTS stream, which is what a bare AAC file is.',
      'Download and feed it to whatever asked for it.',
    ],
    faq: [
      {
        q: 'How is this different from M4A?',
        a: 'M4A is AAC inside an MP4 container, with an index, metadata and chapter support. A `.aac` file is the stream alone with a small header on every frame, so it can be cut and joined anywhere.',
      },
      {
        q: 'Can I add cover art or tags?',
        a: 'No. There is no container to put them in. Anything that needs metadata should be an M4A.',
      },
      {
        q: 'Will it play in a normal music player?',
        a: 'Most will play it, and few will show anything useful about it. Seeking can be imprecise, because there is no index.',
      },
      {
        q: 'Is quality lost?',
        a: 'The audio is re-framed rather than re-encoded where the source codec allows, so quality is preserved through the extraction itself.',
      },
    ],
    note: 'ADTS framing repeats a seven-byte header before every audio frame, which is what makes a raw AAC stream decodable from any point. That redundancy costs about half a percent and is the reason broadcast systems prefer it to a container.',
  },

  'mp4-to-ogg': {
    h1: 'MP4 to OGG for games, Linux and anywhere patents matter',
    intro:
      'The Ogg container carrying Opus is the open web’s audio format: unencumbered, excellent at low bitrates, and standard in game engines, Wikipedia and most Linux tooling. Extracting a video’s soundtrack into one is the usual step before shipping it somewhere that avoids licensed codecs on principle.',
    steps: [
      'Select the MP4 files, either by dropping them here or by pasting from the clipboard.',
      'Pick a bitrate — Opus is efficient enough that 96 kbps is transparent for most material.',
      'Download the OGG. It is ready the moment the job reports that it has finished.',
    ],
    faq: [
      {
        q: 'What codec is inside the OGG?',
        a: 'Opus. It outperforms MP3 and AAC at almost every bitrate and is the codec every modern browser and game engine expects inside an Ogg container.',
      },
      {
        q: 'Will it play on an iPhone?',
        a: 'In Safari and most apps, yes — iOS 17 added native Opus support. Older devices will need a player that bundles its own decoder, such as VLC.',
      },
      {
        q: 'Why is the file smaller than an MP3 at the same bitrate?',
        a: 'It is the same size at the same bitrate. The difference is that Opus sounds appreciably better at that bitrate, so you can set a lower one.',
      },
      {
        q: 'Is Opus good for speech?',
        a: 'It was designed for it. At 32 to 48 kbps a voice recording is clear, which is a quarter of what MP3 would need for the same result.',
      },
    ],
    note: 'Ogg is a container designed for streaming: it interleaves pages with checksums so a decoder can recover from a corrupt or truncated file mid-stream. That resilience is why it was chosen for internet radio long before it was chosen for anything else.',
  },

  'mp4-to-flac': {
    h1: 'MP4 to FLAC to archive a soundtrack without growing a WAV',
    intro:
      'FLAC compresses audio losslessly to about half the size of a WAV, which makes it the sensible archive format for a recording you want to keep exactly. Extracting a video’s audio into FLAC preserves everything the decode produced, tags properly, and does not consume ten megabytes a minute.',
    steps: [
      'Add the MP4 files you want changed. The queue will take as many as you have.',
      'Convert. FLAC is lossless, so there is no quality setting to weigh up.',
      'Download the FLAC and file it away.',
    ],
    faq: [
      {
        q: 'Does FLAC recover quality the MP4 lost?',
        a: 'No, and nothing can. The AAC compression is permanent. FLAC guarantees that no further loss occurs, which is what an archive copy is for.',
      },
      {
        q: 'Is it worth using FLAC on lossy source audio?',
        a: 'It is if the file is a master you will re-encode from later. Every future MP3 or Opus then comes from the same fixed source rather than from a chain of re-encodes.',
      },
      {
        q: 'How much smaller than WAV?',
        a: 'Between forty and sixty percent, depending on the material. Speech compresses best; dense music compresses least.',
      },
      {
        q: 'Does FLAC support surround sound?',
        a: 'Up to eight channels, so a 5.1 soundtrack survives intact rather than being downmixed the way MP3 would force.',
      },
    ],
    note: 'FLAC works by predicting each sample from the ones before it and storing only the error, which is why it compresses speech far better than music. The prediction is exact, so decoding reproduces the original samples bit for bit.',
  },
}
