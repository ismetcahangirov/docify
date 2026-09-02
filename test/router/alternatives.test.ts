// @vitest-environment node

/**
 * What else this device could do with the file (issue #62).
 *
 * The rule the whole module exists to keep: an alternative is only offered once
 * `route()` has said yes to it, with the same sizes and the same device. A
 * rejection that suggests a second conversion the browser also refuses is worse
 * than one that suggests nothing — the user spends another drop finding out.
 */

import { describe, expect, it } from 'vitest'

import { alternativeTargets } from '@/lib/router/alternatives'
import { route } from '@/lib/router/route'
import type { Capabilities, ConversionTask } from '@/lib/router/types'

const desktop: Capabilities = {
  crossOriginIsolated: true,
  wasmSimd: true,
  deviceMemoryGb: 8,
  cores: 8,
  webCodecsVideo: true,
  webCodecsAudio: true,
  offscreenCanvas: true,
  createImageBitmap: true,
  platform: 'desktop',
  browser: 'chromium',
}

const MB = 1024 * 1024

const convert = (from: ConversionTask['from'], to: ConversionTask['to']): ConversionTask => ({
  from,
  to,
  op: 'convert',
})

describe('alternativeTargets', () => {
  it('offers other targets for a source whose requested one is unsupported', () => {
    const targets = alternativeTargets(convert('heic', 'ico'), MB, desktop)

    expect(targets.length).toBeGreaterThan(0)
    expect(targets.map((task) => task.to)).toContain('jpg')
  })

  it('only offers what this device would actually accept', () => {
    for (const task of alternativeTargets(convert('heic', 'ico'), MB, desktop)) {
      expect(route(task, MB, desktop).ok).toBe(true)
    }
  })

  it('never offers the format that was just refused', () => {
    const targets = alternativeTargets(convert('heic', 'ico'), MB, desktop)

    expect(targets.map((task) => task.to)).not.toContain('ico')
  })

  it('never offers converting a file to its own format', () => {
    const targets = alternativeTargets(convert('jpg', 'ico'), MB, desktop)

    expect(targets.map((task) => task.to)).not.toContain('jpg')
  })

  it('keeps the operation the user asked for', () => {
    const targets = alternativeTargets({ from: 'mp4', to: 'flac', op: 'extract' }, MB, desktop)

    for (const task of targets) expect(task.op).toBe('extract')
  })

  /*
   * The device is the point. A browser with no WebCodecs and no isolation is
   * exactly the one that needs a suggestion, and exactly the one where most of
   * them would fail.
   */
  it('shrinks with the browser rather than promising what it cannot do', () => {
    const weak: Capabilities = {
      ...desktop,
      crossOriginIsolated: false,
      wasmSimd: false,
      webCodecsVideo: false,
      webCodecsAudio: false,
    }

    const strong = alternativeTargets(convert('heic', 'ico'), MB, desktop)
    const weakly = alternativeTargets(convert('heic', 'ico'), MB, weak)

    expect(weakly.length).toBeLessThan(strong.length)
    for (const task of weakly) expect(route(task, MB, weak).ok).toBe(true)
  })

  it('offers nothing at all for a source no engine can read', () => {
    expect(alternativeTargets(convert('rar', 'zip'), MB, desktop)).toEqual([])
  })

  it('offers nothing when the file itself is the problem', () => {
    expect(alternativeTargets(convert('heic', 'ico'), 0, desktop)).toEqual([])
  })

  it('stops at the limit, keeping the most likely targets first', () => {
    const targets = alternativeTargets(convert('heic', 'ico'), MB, desktop, 2)

    expect(targets).toHaveLength(2)
    expect(targets[0]?.to).toBe('jpg')
  })

  it('is deterministic — the same question twice gives the same answer', () => {
    const once = alternativeTargets(convert('mov', 'rar'), MB, desktop)
    const twice = alternativeTargets(convert('mov', 'rar'), MB, desktop)

    expect(once).toEqual(twice)
  })

  /*
   * A 4 GB video on a phone is refused for size, not for format, and every
   * alternative container is refused for the same size. Offering them anyway is
   * the failure mode this asserts against.
   */
  it('offers nothing when every alternative is refused for the same reason', () => {
    const phone: Capabilities = { ...desktop, deviceMemoryGb: 2, platform: 'ios' }

    expect(alternativeTargets(convert('mov', 'rar'), 4096 * MB, phone)).toEqual([])
  })
})
