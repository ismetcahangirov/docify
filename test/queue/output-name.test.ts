// @vitest-environment node

/**
 * What a converted file is called (issue #61).
 *
 * The name is the only part of the result the user sees before they open it, so
 * the rules here are about recognisability rather than correctness: the stem
 * survives untouched, and only the extension moves.
 */

import { describe, expect, it } from 'vitest'

import { extensionOf, outputName } from '@/lib/queue/output-name'

describe('extensionOf', () => {
  it('gives the extension a file of that format is normally written with', () => {
    expect(extensionOf('jpg')).toBe('.jpg')
    expect(extensionOf('png')).toBe('.png')
    expect(extensionOf('mp4')).toBe('.mp4')
  })

  it('uses the three-letter TIFF suffix, which is what every writer emits', () => {
    expect(extensionOf('tiff')).toBe('.tif')
  })

  it('answers for every format the router knows', () => {
    const formats = [
      'jpg',
      'png',
      'webp',
      'avif',
      'gif',
      'bmp',
      'tiff',
      'svg',
      'heic',
      'ico',
      'pdf',
      'txt',
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
      'zip',
      'rar',
      '7z',
      'tar',
    ] as const

    for (const format of formats) {
      expect(extensionOf(format)).toMatch(/^\.[a-z0-9]+$/)
    }
  })
})

describe('outputName', () => {
  it('swaps the extension and keeps the stem', () => {
    expect(outputName('IMG_4021.HEIC', 'jpg')).toBe('IMG_4021.jpg')
  })

  it('only replaces the last extension, so a dotted stem survives', () => {
    expect(outputName('report.final.v2.png', 'webp')).toBe('report.final.v2.webp')
  })

  it('appends when the source has no extension at all', () => {
    expect(outputName('scan', 'pdf')).toBe('scan.pdf')
  })

  it('leaves a leading dot alone rather than reading it as an extension', () => {
    expect(outputName('.profile', 'txt')).toBe('.profile.txt')
  })

  it('falls back to a name rather than producing a bare extension', () => {
    expect(outputName('', 'png')).toBe('converted.png')
    expect(outputName('   ', 'png')).toBe('converted.png')
  })

  it('strips the directory a folder drop puts in front of the name', () => {
    expect(outputName('holiday/2024/beach.heic', 'jpg')).toBe('beach.jpg')
    expect(outputName('C:\\photos\\beach.heic', 'jpg')).toBe('beach.jpg')
  })
})
