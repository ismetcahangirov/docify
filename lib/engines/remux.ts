/**
 * The stream-copy engine: the same encoded bytes, in a different box.
 *
 * ## Why it outranks every codec
 *
 * Priority 12 — ahead of WebCodecs at 15 and ffmpeg at 90 — because a job it can
 * take is a job nothing else should. Pulling the AAC track out of a two-hour MP4
 * is an index walk and a container write: seconds on a phone, whatever the
 * file's size, with no encoder involved and no quality given up. WebCodecs would
 * decode and re-encode the same audio on the GPU for a result that is strictly
 * worse and a hundred times slower; ffmpeg would do it in software, on one core,
 * after a 31 MB download.
 *
 * It follows that this engine must claim *only* what it can genuinely copy. A
 * pair it takes and cannot finish is not a slow conversion, it is a failed one:
 * `route()` hands the head of the candidate list to the worker and never asks a
 * second engine. That is why `supports` is a short whitelist rather than a
 * family — MP3, WAV, FLAC and Ogg all need an encoder, so they stay with ffmpeg.
 *
 * ## What a container change does and does not promise
 *
 * MOV and MP4 are the same box structure with a different brand on it, so
 * changing one into the other is a rewrite of the index and nothing else. What
 * that promises is the container the user asked for, with the picture and the
 * sound bit-for-bit unchanged. What it does not promise is a *codec* they can
 * play everywhere: a MOV holding ProRes becomes an MP4 holding ProRes, which is
 * a valid MP4 that a phone will still refuse. Changing the codec means decoding
 * and re-encoding, which is `compress` and the transcode engines — and if the
 * file is too large for this engine's budget, that is exactly where it goes.
 *
 * ## Why it needs no capability at all
 *
 * `supports` ignores `Capabilities` on purpose, and that is the substantive
 * difference from `./webcodecs`. Nothing here touches `VideoEncoder`,
 * `AudioEncoder` or a WASM codec, so a browser with no media codecs whatsoever
 * still extracts audio perfectly. Gating it behind `caps.webCodecsAudio` would
 * refuse a job that has no codec in it.
 *
 * ## Lazy loading
 *
 * Only the descriptor is statically importable. mp4box.js — 120 kB, and the
 * engine's entire download — hangs off `createRunner()`'s `await import()`
 * (CLAUDE.md §2.3).
 */

import { throwIfAborted } from '@/lib/abort'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

/**
 * The download: mp4box.js, and nothing else.
 *
 * The same figure as `WEBCODECS_LOAD_COST`, because it is the same library — but
 * stated here rather than imported from there, so that neither engine's number
 * moves when the other's does. The router quotes it to the user.
 */
export const REMUX_LOAD_COST = 122_000

/** Sources built on the ISO base media file format, which mp4box can read. */
const ISO_SOURCES: ReadonlySet<FormatId> = new Set(['mp4', 'mov'])

/**
 * Targets whose container this can write *and* whose codec the source already
 * holds.
 *
 * `m4a` only: it is an ISO container carrying whatever audio codec the source
 * had — AAC in practice — so the samples go straight back in. `aac` is a raw
 * ADTS stream, which means synthesising a header per frame out of the `esds`,
 * and `mp3`, `wav`, `flac` and `ogg` are different codecs entirely. All of those
 * are encodes, and encodes belong to ffmpeg.
 */
const COPYABLE_AUDIO: ReadonlySet<FormatId> = new Set(['m4a'])

/**
 * Containers this can write, holding whatever codec the source already had.
 *
 * MP4 and MOV, which are the same ISO box structure under two brands. WebM,
 * MKV and AVI are not that structure at all and mp4box can write none of them.
 */
const COPYABLE_CONTAINERS: ReadonlySet<FormatId> = new Set(['mp4', 'mov'])

/**
 * Which operations a copy may claim, and why the list is this short.
 *
 * `convert` is "put this in a different container", which is precisely what a
 * remux is. `extract` is "give me the sound out of this", which is the same
 * copy with the picture left behind. A `convert` whose target is an audio
 * container is that extraction by another name: every catalogue page sends
 * `convert` because the URL is keyed on the format pair, so `/convert/mp4-to-m4a`
 * has to be answered here or the job goes to an encoder for nothing (issue
 * #266). What to keep is therefore decided by the *target*, not by the op.
 *
 * `compress` and `resize` are deliberately absent, and that is the line that
 * keeps this engine honest. Both arrive from a settings panel carrying a target
 * size, a quality or a width, and a stream copy honours none of them — it
 * cannot, there is no encoder in the path. Claiming either would silently
 * discard what the user just chose and hand back a file that ignores the panel
 * they filled in. Losing the copy's speed is the price of doing what was asked.
 *
 * The same reasoning excludes a `convert` whose source and target are the same
 * format: there is no container to change, so the job is asking for something
 * else and an engine that re-encodes should answer it.
 */
const COPYABLE_OPERATIONS: ReadonlySet<Operation> = new Set(['convert', 'extract'])

export const descriptor: EngineDescriptor = {
  id: 'remux',
  label: 'Stream copy (no re-encode)',
  loadCost: REMUX_LOAD_COST,
  // The lowest number in the video table. Only Canvas at 10 is cheaper, and it
  // never claims a container.
  priority: 12,
  supports(task: ConversionTask, caps: Capabilities): boolean {
    // Deliberately unused: see the module header. A copy needs no codec, so no
    // capability can make it impossible.
    void caps

    if (!COPYABLE_OPERATIONS.has(task.op)) return false
    if (!ISO_SOURCES.has(task.from)) return false

    if (task.op === 'extract') return COPYABLE_AUDIO.has(task.to)

    // Only where there is a container to change.
    if (task.from === task.to) return false

    // A container change, or the sound alone in its own container.
    return COPYABLE_CONTAINERS.has(task.to) || COPYABLE_AUDIO.has(task.to)
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

      const { remuxMp4 } = await import('./mp4-remux')
      throwIfAborted(signal)

      // By the target, not the op: `supports` only lets `extract` through to
      // an audio target anyway, and a `convert` into M4A is the same job. An
      // audio container holding a video track is a silent film with the wrong
      // label on it.
      const extracting = COPYABLE_AUDIO.has(input.task.to)
      const written = await remuxMp4(
        bytes,
        // An extraction leaves the picture behind; a container change carries
        // everything the source had. Only the extraction insists on AAC: it is
        // the one whose output claims to be an M4A (issue #277).
        {
          keep: extracting ? ['audio'] : ['video', 'audio'],
          audioMustBeAac: extracting,
        },
        signal,
        onProgress,
      )

      return new Blob([written], { type: mimeTypeFor(input.task.to, extracting) })
    },
  }
}

/**
 * What the finished file is labelled.
 *
 * All three are the same box structure, and the label is what tells a browser
 * whether it has been handed a movie or a track: an M4A served as `video/mp4`
 * opens a black player window with sound coming out of it.
 */
function mimeTypeFor(to: FormatId, extracting: boolean): string {
  if (extracting) return 'audio/mp4'

  return to === 'mov' ? 'video/quicktime' : 'video/mp4'
}

function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(`A stream copy takes one file at a time, but ${input.files.length} were given.`)
  }

  return input.files[0]
}
