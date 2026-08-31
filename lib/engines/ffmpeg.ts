/**
 * The ffmpeg.wasm engine: the last resort, and the one that always works.
 *
 * ## Why it is last
 *
 * Priority 90, behind every other engine by a wide margin, and the margin is the
 * point. It downloads 31 MB, it runs on one core, and it decodes in software
 * what WebCodecs decodes on a GPU — a minute of 1080p is seconds there and
 * minutes here. Nothing should reach it that another engine could have taken,
 * which is what the ordering guarantees: `route()` takes the head of a list
 * already sorted by preference, so ffmpeg is chosen only when it is the sole
 * candidate left.
 *
 * What it buys for that price is everything else. WebM, MKV and AVI are not the
 * ISO base media format and mp4box can neither read nor write them; MP3 has no
 * browser encoder at all; and a codec inside a container that WebCodecs happens
 * not to support has nowhere else to go. This engine has libx264, libx265,
 * libvpx, libmp3lame, libvorbis, libopus and libtheora compiled in, and it takes
 * the jobs the fast paths have already turned down.
 *
 * ## Single-threaded, whatever the page
 *
 * The vendored build is `--disable-pthreads` (see `./ffmpeg-runtime`), so it
 * uses one core on an isolated page and one core on an ordinary one. The
 * router's `NO_ISOLATION` warning therefore *understates* the position rather
 * than misstating it: what it says is true when it fires, and the isolated case
 * is no better. Making it better needs the separate `@ffmpeg/core-mt` build,
 * which doubles the 31 MB — a trade worth making deliberately rather than as a
 * side effect of this issue.
 *
 * ## Lazy loading, and what "lazy" has to mean at this size
 *
 * Only the descriptor below is statically importable, and the runner does not
 * touch the core either: it is fetched by URL from `public/vendor/ffmpeg/` on
 * the first job that actually needs it. At 31 MB the difference between "in the
 * bundle" and "fetched on demand" is the difference between a usable site and an
 * unusable one (CLAUDE.md §2.3).
 */

import { throwIfAborted } from '@/lib/abort'
import type { Capabilities, ConversionTask, FormatId, Operation } from '@/lib/router/types'

import { isFfmpegTarget } from './ffmpeg-args'
import { FFMPEG_LOAD_COST } from './ffmpeg-runtime'
import type { EngineDescriptor, EngineInput, EngineRunner, ProgressCallback } from './types'

export { FFMPEG_LOAD_COST }

/** Containers ffmpeg reads. Every one it writes, plus the ones it only demuxes. */
const READABLE: ReadonlySet<FormatId> = new Set([
  'mp4',
  'webm',
  'mov',
  'mkv',
  'avi',
  'mp3',
  'wav',
  'ogg',
  'm4a',
  'flac',
  'aac',
])

/** Formats with a picture in them. `extract` turns one of these into sound alone. */
const VIDEO_FORMATS: ReadonlySet<FormatId> = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi'])

const OPERATIONS: ReadonlySet<Operation> = new Set(['convert', 'compress', 'extract'])

export const descriptor: EngineDescriptor = {
  id: 'ffmpeg',
  label: 'Universal fallback (ffmpeg)',
  loadCost: FFMPEG_LOAD_COST,
  // The last number in the table, deliberately far from the rest: nothing that
  // another engine can take should ever land here.
  priority: 90,
  supports(task: ConversionTask, caps: Capabilities): boolean {
    void caps

    if (!OPERATIONS.has(task.op)) return false
    if (!READABLE.has(task.from) || !isFfmpegTarget(task.to)) return false

    // Pulling the sound out of something with no picture is not an extraction,
    // it is a conversion — and claiming it here would give the same job two
    // names.
    if (task.op === 'extract') return VIDEO_FORMATS.has(task.from) && !VIDEO_FORMATS.has(task.to)

    return true
  },
}

/**
 * Builds the runner. Nothing is loaded here: the core is 31 MB and the user may
 * still cancel — which, on a download that long, is the likeliest cancel there
 * is.
 */
export function createRunner(): EngineRunner {
  return {
    async run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback) {
      throwIfAborted(signal)

      const source = onlyFile(input)
      const bytes = new Uint8Array(await source.arrayBuffer())
      throwIfAborted(signal)

      // Indeterminate while the core downloads: there is nothing to report a
      // fraction of, and the wait is measured in tens of seconds.
      onProgress(-1)

      const [{ loadFfmpegCore }, { runFfmpeg }] = await Promise.all([
        import('./ffmpeg-runtime'),
        import('./ffmpeg-run'),
      ])
      throwIfAborted(signal)

      const core = await loadFfmpegCore()
      throwIfAborted(signal)

      const result = await runFfmpeg({
        core,
        bytes,
        job: {
          from: input.task.from,
          to: input.task.to,
          // `extract` is the operation that means "keep the sound and drop the
          // picture"; every other operation keeps whatever the target can hold.
          keepVideo: input.task.op !== 'extract' && VIDEO_FORMATS.has(input.task.to),
          video: input.video,
          audio: input.audio,
        },
        signal,
        onProgress,
      })

      return new Blob([result.bytes], { type: result.mimeType })
    },
  }
}

function onlyFile(input: EngineInput): Blob {
  if (input.files.length !== 1) {
    throw new Error(
      `This conversion takes one file at a time, but ${input.files.length} were given.`,
    )
  }

  return input.files[0]
}
