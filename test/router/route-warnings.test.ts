// @vitest-environment node
//
// Deliberately not jsdom. `route()` runs during SSR, inside a Web Worker and in
// the browser, and it is only allowed to look at the three arguments it is
// handed, so a `window` or `document` read inside it must throw here rather
// than pass quietly. `route-purity.test.ts` closes the remaining gap.
//
// The warnings attached to a successful route: which ones fire, at which
// threshold, and in which order.

import { describe, expect, it, vi } from 'vitest'

import { LARGE_DOWNLOAD_BYTES, route } from '@/lib/router/route'

import {
  chosen,
  desktop,
  fake,
  ffmpeg,
  heicToJpg,
  jpgToPng,
  MB,
  mp4ToWebm,
  register,
  resetRegistryBetweenTests,
  warningCodes,
  withEngines,
} from './support/route-harness'

// `vi.mock` is hoisted to the top of the file, so the call cannot be shared —
// only the replacement module it returns, which the harness builds.
vi.mock('@/lib/engines/registry', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/engines/registry')>()

  return (await import('./support/route-harness')).mockedRegistry(actual)
})

resetRegistryBetweenTests()

describe('route — warnings', () => {
  it('warns LARGE_DOWNLOAD above the 8 MB threshold and not at it', () => {
    expect(LARGE_DOWNLOAD_BYTES).toBe(8 * MB)

    const atLimit = withEngines([fake('vips', { loadCost: LARGE_DOWNLOAD_BYTES })], () =>
      warningCodes(route(jpgToPng, MB, desktop)),
    )
    const overLimit = withEngines([fake('vips', { loadCost: LARGE_DOWNLOAD_BYTES + 1 })], () =>
      warningCodes(route(jpgToPng, MB, desktop)),
    )

    expect(atLimit).not.toContain('LARGE_DOWNLOAD')
    expect(overLimit).toContain('LARGE_DOWNLOAD')
  })

  it('warns QUALITY_LOSS only when both sides of the pair are lossy', () => {
    register(fake('vips'))

    expect(warningCodes(route({ from: 'jpg', to: 'webp', op: 'convert' }, MB, desktop))).toContain(
      'QUALITY_LOSS',
    )
    // HEIC is lossy too, so the flagship heic→jpg conversion has to warn.
    expect(warningCodes(route(heicToJpg, MB, desktop))).toContain('QUALITY_LOSS')
    // FLAC and WAV are the lossless audio formats and must stay silent.
    expect(
      warningCodes(route({ from: 'flac', to: 'wav', op: 'convert' }, MB, desktop)),
    ).not.toContain('QUALITY_LOSS')
    expect(
      warningCodes(route({ from: 'jpg', to: 'png', op: 'convert' }, MB, desktop)),
    ).not.toContain('QUALITY_LOSS')
    expect(
      warningCodes(route({ from: 'png', to: 'jpg', op: 'convert' }, MB, desktop)),
    ).not.toContain('QUALITY_LOSS')
  })

  it('warns LAYOUT_LOSS for a text target, which is a different loss from a re-encode', () => {
    register(fake('pdfjs'))

    const codes = warningCodes(route({ from: 'pdf', to: 'txt', op: 'convert' }, MB, desktop))

    // Nothing is being re-encoded and the words themselves are exact; what a
    // .txt cannot hold is everything that was not text. That is the sentence the
    // acceptance criterion asks the user to be told before they convert.
    expect(codes).toContain('LAYOUT_LOSS')
    expect(codes).not.toContain('QUALITY_LOSS')
  })

  it('says plainly that a text file is not an editable copy of the document', () => {
    register(fake('pdfjs'))

    const warning = chosen(
      route({ from: 'pdf', to: 'txt', op: 'convert' }, MB, desktop),
    ).warnings.find((entry) => entry.code === 'LAYOUT_LOSS')

    expect(warning?.message).toMatch(/not an editable copy/)
  })

  it('does not warn about layout when nothing had a layout to lose', () => {
    register(fake('pdfjs'))

    expect(
      warningCodes(route({ from: 'txt', to: 'txt', op: 'convert' }, MB, desktop)),
    ).not.toContain('LAYOUT_LOSS')
  })

  it('reports the ffmpeg fallback in a fixed order: slow, single-threaded, download, quality', () => {
    register(ffmpeg())

    const codes = warningCodes(
      route(mp4ToWebm, 10 * MB, { ...desktop, crossOriginIsolated: false }),
    )

    expect(codes).toEqual(['SLOW_PATH', 'NO_ISOLATION', 'LARGE_DOWNLOAD', 'QUALITY_LOSS'])
  })

  it('warns that ffmpeg is single-threaded however the page is served', () => {
    register(ffmpeg())

    const isolated = warningCodes(route(mp4ToWebm, 10 * MB, desktop))
    const single = warningCodes(
      route(mp4ToWebm, 10 * MB, { ...desktop, crossOriginIsolated: false }),
    )

    // The vendored core is built `--disable-pthreads` — see
    // `lib/engines/ffmpeg-runtime.ts` — so it runs on one core on an isolated
    // page too. Firing only on the non-isolated one told half the users the
    // truth and left the other half expecting cores that do not exist.
    expect(isolated).toContain('NO_ISOLATION')
    // And once on the page that used to be the only one warned, not twice.
    expect(single.filter((code) => code === 'NO_ISOLATION')).toHaveLength(1)
  })

  it('blames the ffmpeg build for the single core rather than the page', () => {
    register(ffmpeg())

    const warning = chosen(route(mp4ToWebm, 10 * MB, desktop)).warnings.find(
      (candidate) => candidate.code === 'NO_ISOLATION',
    )

    expect(warning?.message).toBe(
      'Running single-threaded: this build of ffmpeg uses one CPU core, so long files take a while.',
    )
  })

  it('quotes the download size in the LARGE_DOWNLOAD message', () => {
    register(ffmpeg())

    const warning = chosen(route(mp4ToWebm, 10 * MB, desktop)).warnings.find(
      (candidate) => candidate.code === 'LARGE_DOWNLOAD',
    )

    expect(warning?.message).toContain('31 MB')
  })
})
