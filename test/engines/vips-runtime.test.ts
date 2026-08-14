/**
 * The self-hosting contract for wasm-vips.
 *
 * Two invariants are guarded here. Every byte comes from Docify's own origin,
 * because CLAUDE.md §3 forbids CDN requests and `Cross-Origin-Embedder-Policy:
 * require-corp` would block them anyway. And the `loadCost` the router prices
 * the engine with is measured against the installed package rather than
 * remembered from a plan document, so a version bump that changes the download
 * fails here instead of quietly making the router's cost model wrong.
 */

import { statSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  VIPS_ASSET_PATH,
  VIPS_ASSETS,
  VIPS_BASE_LOAD_COST,
  VIPS_CORE_WASM,
  VIPS_HEIF_LOAD_COST,
  VIPS_HEIF_WASM,
  VIPS_MODULE_FILE,
  vipsModuleUrl,
} from '@/lib/engines/vips-runtime'
import { VIPS_VENDORED_FILES, vipsLibDir } from '@/scripts/vendor-wasm-vips/vendor.mjs'

const bytesOf = (file: string): number => statSync(join(vipsLibDir(), file)).size

describe('where wasm-vips is fetched from', () => {
  it('resolves to this origin, never a CDN', () => {
    expect(vipsModuleUrl('https://docify.app/convert/heic-to-jpg')).toBe(
      'https://docify.app/vendor/wasm-vips/vips-es6.js',
    )
  })

  it('is rooted at the origin, so a nested route resolves it identically', () => {
    expect(vipsModuleUrl('https://docify.app/tools/resize/deeply/nested')).toBe(
      vipsModuleUrl('https://docify.app/'),
    )
  })

  it('says where to look when there is no origin at all', () => {
    // Server rendering, or a test without a location. `new URL()` would throw
    // about an invalid base, which points nowhere useful.
    expect(() => vipsModuleUrl('')).toThrow(/browser/i)
  })

  it('says the same when the origin is opaque, which serialises to "null"', () => {
    // A sandboxed iframe, or a document loaded from a data: or blob: URL. The
    // string is not empty, so an emptiness check waves it through and
    // `new URL(path, 'null')` throws `Invalid URL` — the failure the guard exists
    // to replace.
    expect(() => vipsModuleUrl('null')).toThrow(/browser/i)
  })

  it('serves the module from the directory the vendor script writes', () => {
    expect(VIPS_ASSET_PATH).toBe('/vendor/wasm-vips/')
    expect(VIPS_ASSETS).toContain(VIPS_MODULE_FILE)
  })
})

describe('the vendored file list', () => {
  it('matches what the vendor script copies, in both directions', () => {
    expect([...VIPS_ASSETS]).toEqual(VIPS_VENDORED_FILES)
  })

  it('names files that exist in the installed package', () => {
    for (const file of VIPS_ASSETS) expect(bytesOf(file)).toBeGreaterThan(0)
  })

  it('leaves out the side modules no Docify format needs', () => {
    // JPEG-XL is not a format the app offers, and SVG rendering is Canvas' job.
    expect(VIPS_ASSETS).not.toContain('vips-jxl.wasm')
    expect(VIPS_ASSETS).not.toContain('vips-resvg.wasm')
  })
})

describe('the load cost the router prices vips with', () => {
  it('is the measured size of the JS shim plus the core WASM', () => {
    expect(VIPS_BASE_LOAD_COST).toBe(bytesOf(VIPS_MODULE_FILE) + bytesOf(VIPS_CORE_WASM))
  })

  it('charges the HEIF side module separately, because only AVIF and HEIC pay it', () => {
    expect(VIPS_HEIF_LOAD_COST).toBe(bytesOf(VIPS_HEIF_WASM))
  })

  it('stays under the 8 MB LARGE_DOWNLOAD threshold for the base engine', () => {
    expect(VIPS_BASE_LOAD_COST).toBeLessThan(8 * 1024 * 1024)
  })
})
