/**
 * The WebCodecs engine: the browser's own video hardware, for free.
 *
 * ## Why it sits at the top of the video table
 *
 * Priority 15, ahead of everything except Canvas. It is the only engine that
 * reaches a machine's hardware encoder, and the difference is not a percentage:
 * a minute of 1080p that ffmpeg.wasm grinds through in several minutes on one
 * core takes seconds here. Commercial converters put GPU encoding behind a paid
 * tier; routing to WebCodecs gives it to everyone, on their own device, with
 * nothing downloaded.
 *
 * ## What it claims, and what it leaves to ffmpeg
 *
 * ISO base media containers in, MP4 out — `mp4` and `mov`, which are the same
 * box structure with a different brand. WebM, MKV and AVI are not that structure
 * and mp4box cannot read or write them, so those pairs fall to `ffmpeg` (issue
 * #49), which is exactly what the priority ordering is for.
 *
 * Audio is not carried yet. A transcode that silently dropped a soundtrack would
 * be worse than one that says so, so until the audio path lands (issue #48) the
 * engine claims the operations where losing it is either impossible or the
 * point — and `./video-transcode` explains itself when a file turns out to have
 * only sound.
 *
 * ## What gates it
 *
 * `caps.webCodecsVideo`, and `route()` checks it a second time by name — see
 * `missingCapability` there. Neither check is redundant: this one keeps the
 * engine out of the candidate list, and that one turns a missing API into a
 * rejection that names it rather than a bare `UNSUPPORTED_PAIR`.
 *
 * ## Lazy loading
 *
 * Only the descriptor below is statically importable. mp4box.js and the whole
 * transcode pipeline hang off `createRunner()`'s `await import()` (CLAUDE.md
 * §2.3), which is also why this file can talk about `VideoEncoder` and never
 * mention it.
 */

import { throwIfAborted } from '@/lib/abort'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

import { isAudioTarget } from './audio-config'
import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

/**
 * The download: mp4box.js, and nothing else.
 *
 * The codecs are the platform's and cost nothing. Measured from the package's
 * own minified build rather than estimated, on the same terms as
 * `PDFLIB_LOAD_COST` — the router quotes it to the user.
 */
export const WEBCODECS_LOAD_COST = 122_000

/** Containers built on the ISO base media file format, which mp4box can read. */
const ISO_CONTAINERS: ReadonlySet<FormatId> = new Set(['mp4', 'mov', 'm4a'])

/**
 * Sources whose picture is what the job is about.
 *
 * `m4a` is the same box structure as `mp4` with a different extension and, by
 * convention, no video track — so it can be read but never converted *as* video.
 */
const VIDEO_SOURCES: ReadonlySet<FormatId> = new Set(['mp4', 'mov'])

/**
 * Operations this engine implements.
 *
 * `convert` is a container or codec change; `compress` is the same pipeline
 * aimed at a bitrate. Both re-encode, which is what separates them from the
 * stream-copy remux of issue #53.
 */
const VIDEO_OPERATIONS: ReadonlySet<Operation> = new Set(['convert', 'compress'])

export const descriptor: EngineDescriptor = {
  id: 'webcodecs',
  label: 'Hardware-accelerated (WebCodecs)',
  loadCost: WEBCODECS_LOAD_COST,
  // Ahead of every other video engine and behind Canvas, which costs nothing at
  // all. The number matters exactly once: against `ffmpeg` at 90.
  priority: 15,
  supports(task: ConversionTask, caps: Capabilities): boolean {
    if (!VIDEO_OPERATIONS.has(task.op)) return false
    if (!ISO_CONTAINERS.has(task.from)) return false

    // Two paths, gated on two different capabilities — a browser can genuinely
    // have one family of codecs and not the other, which is why `Capabilities`
    // probes them apart.
    if (isAudioTarget(task.to) && task.to !== 'mp4') return caps.webCodecsAudio
    if (task.to !== 'mp4' || !VIDEO_SOURCES.has(task.from)) return false

    return caps.webCodecsVideo
  },
}

/**
 * Builds the runner. Nothing is loaded here: mp4box is 120 kB and the user may
 * still cancel.
 */
export function createRunner(): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const source = onlyFile(input)
      const bytes = new Uint8Array(await source.arrayBuffer())
      throwIfAborted(signal)

      // One `await import()` per path, each with a literal specifier: a
      // computed one would defeat the bundler's static analysis and collapse
      // both pipelines into a single chunk (CLAUDE.md §2.3).
      if (input.task.to !== 'mp4') {
        const { transcodeAudio } = await import('./audio-transcode')
        throwIfAborted(signal)

        const audio = await transcodeAudio(bytes, input.task.to, input.audio, signal, onProgress)

        return new Blob([audio.bytes], { type: audio.mimeType })
      }

      const { transcodeVideo } = await import('./video-transcode')
      throwIfAborted(signal)

      const written = await transcodeVideo(bytes, input.video, signal, onProgress)

      return new Blob([written], { type: 'video/mp4' })
    },
  }
}

function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Video conversion takes one file at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
