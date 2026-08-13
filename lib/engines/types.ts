/**
 * The engine contract, split in two halves on purpose.
 *
 * `EngineDescriptor` is synchronous and tiny — statically imported into the
 * registry so the router can *know about* every engine without *loading* any
 * of them. `EngineRunner` is the heavy half: it is reached only through a
 * `dynamic import()`, only inside the conversion worker, and only after the
 * router has actually chosen that engine.
 */

import type { Capabilities, ConversionTask, EngineId } from '@/lib/router/types'

export interface EngineDescriptor {
  id: EngineId
  /** Name shown to the user, e.g. "Hardware-accelerated (WebCodecs)". */
  label: string
  /** WASM/JS binary download size in bytes. The router prefers the cheaper option. */
  loadCost: number
  /** Lower is better. Orders engines that support the same task. */
  priority: number
  /**
   * Decided from the task and the device alone — never from the file itself.
   * Synchronous, because the router performs no I/O and never awaits.
   */
  supports(task: ConversionTask, caps: Capabilities): boolean
}

/** Operation settings: quality, target width, page range, and so on. */
export type EngineOptions = Readonly<Record<string, string | number | boolean>>

export interface EngineInput {
  task: ConversionTask
  /** Source files in user order. Single-file operations receive exactly one. */
  files: readonly Blob[]
  options?: EngineOptions
}

/**
 * Fractional completion in the range `0..1`, or `-1` for indeterminate mode
 * when the engine genuinely cannot report progress. Must fire at least every
 * 250 ms so the UI never looks dead.
 */
export type ProgressCallback = (progress: number) => void

export interface EngineRunner {
  /**
   * `signal` must be honoured for real: check `signal.aborted` before starting
   * and tear the engine down on `abort`, rather than merely stopping to report.
   */
  run(input: EngineInput, signal: AbortSignal, onProgress: ProgressCallback): Promise<Blob>
}
