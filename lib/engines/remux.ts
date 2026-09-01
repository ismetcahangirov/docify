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
import type { Capabilities, ConversionTask, FormatId } from '@/lib/router/types'

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
 * Why only `extract`, and not the `convert` that reaches the same pair.
 *
 * "Extract the audio" means take what is there; "convert MP4 to M4A" arrives
 * from a settings panel that may have named a bitrate, a sample rate or a
 * channel count. A stream copy honours none of those — it cannot, there is no
 * encoder in the path — so claiming `convert` would silently discard whatever
 * the user chose and hand back a file that ignores the panel they just filled
 * in. That job belongs to an engine that re-encodes, and losing the copy's speed
 * is the price of doing what was asked.
 */
const COPYABLE_OPERATION = 'extract'

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

    if (task.op !== COPYABLE_OPERATION) return false

    return ISO_SOURCES.has(task.from) && COPYABLE_AUDIO.has(task.to)
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

      const written = await remuxMp4(bytes, { keep: ['audio'] }, signal, onProgress)

      return new Blob([written], { type: 'audio/mp4' })
    },
  }
}

function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `Audio extraction takes one file at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
