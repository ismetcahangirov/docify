/**
 * Two ways to get an ffmpeg core in a test: a fake, and the real one.
 *
 * The fake is for the choreography — what gets written, what gets deleted, what
 * happens on a cancel — which is where the bugs are and which a real 31 MB
 * binary would only make slower to check.
 *
 * The real one is for the two claims a fake cannot make: that the arguments this
 * project builds are arguments ffmpeg accepts, and that a conversion produces a
 * file. It runs in Node with three shims, because the vendored build targets a
 * browser or a worker and reads `self.location` on the way up.
 *
 * Test-support code, not shipped.
 */

import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

import type { FfmpegCore, FfmpegLogMessage, FfmpegProgress } from '@/lib/engines/ffmpeg-runtime'

/** One `exec` the fake was asked to run. */
export interface FakeExec {
  args: string[]
  /** What was in the filesystem when it started. */
  files: string[]
}

export interface FakeFfmpeg extends FfmpegCore {
  /** The filesystem, as a plain map. Empty is what a finished job must leave. */
  files: Map<string, Uint8Array>
  execs: FakeExec[]
  resets: number
  /** The deadline in force. Set to a past value, this is a cancellation. */
  deadline: number
  /** What `exec` answers. Non-zero is a failure. */
  status: number
  /**
   * What a probe run answers. Non-zero, like the real thing: `ffmpeg -i <file>`
   * always exits complaining that no output file was given.
   */
  probeStatus: number
  /** Runs inside `exec`, where ffmpeg would be encoding. */
  duringExec?: (fake: FakeFfmpeg) => void
  /** The bytes `exec` leaves at the output path. Absent writes four. */
  output?: Uint8Array
  logger: (message: FfmpegLogMessage) => void
  progress: (progress: FfmpegProgress) => void
}

export function fakeFfmpeg(): FakeFfmpeg {
  const fake: FakeFfmpeg = {
    files: new Map(),
    execs: [],
    resets: 0,
    deadline: -1,
    status: 0,
    probeStatus: 1,
    logger: () => {},
    progress: () => {},

    FS: {
      writeFile(path, data) {
        fake.files.set(path, data)
      },
      readFile(path) {
        const data = fake.files.get(path)
        if (data === undefined) throw new Error(`ENOENT: ${path}`)

        return data
      },
      unlink(path) {
        if (!fake.files.delete(path)) throw new Error(`ENOENT: ${path}`)
      },
      readdir: () => [...fake.files.keys()],
    },

    exec(...args: string[]): number {
      fake.execs.push({ args, files: [...fake.files.keys()] })
      fake.duringExec?.(fake)

      // A run whose last argument names a file that already exists is a probe
      // (`ffmpeg -i <input>`), not a conversion: real ffmpeg refuses it because
      // no output was named, and it certainly does not write over the input.
      const destination = args[args.length - 1]
      const isProbe = destination.startsWith('-') || fake.files.has(destination)

      if (isProbe) return fake.probeStatus

      if (fake.status === 0) {
        fake.files.set(destination, fake.output ?? new Uint8Array([1, 2, 3, 4]))
      }

      return fake.status
    },

    setLogger(logger) {
      fake.logger = logger
    },
    setProgress(handler) {
      fake.progress = handler
    },
    setTimeout(seconds) {
      fake.deadline = seconds
    },
    reset() {
      fake.resets += 1
    },
  }

  return fake
}

/** Where `pnpm install` put the ESM core. */
function coreDir(): string {
  const umd = createRequire(import.meta.url).resolve('@ffmpeg/core')

  return join(dirname(dirname(umd)), 'esm')
}

/**
 * The real core, loaded in Node.
 *
 * Three shims, all of them because the build targets a browser: `self` and
 * `self.location` are read while the module evaluates, and `wasmBinary` is
 * handed over directly because Node's `fetch` refuses a `file:` URL. None of the
 * three is needed in the worker this actually runs in.
 */
export async function realFfmpeg(): Promise<FfmpegCore> {
  const dir = pathToFileURL(`${coreDir()}/`)
  const globals = globalThis as unknown as { self?: unknown; location?: unknown }
  globals.self ??= globalThis
  globals.location ??= { href: dir.href }

  const factory = (
    (await import(new URL('ffmpeg-core.js', dir).href)) as {
      default: (config: unknown) => Promise<FfmpegCore>
    }
  ).default

  return factory({
    print: () => {},
    printErr: () => {},
    locateFile: (file: string) => new URL(file, dir).href,
    wasmBinary: readFileSync(new URL('ffmpeg-core.wasm', dir)),
  })
}
