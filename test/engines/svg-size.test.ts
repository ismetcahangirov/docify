import { describe, expect, it } from 'vitest'

import { DEFAULT_SVG_SIZE, sizedSvg, svgSize } from '@/lib/engines/svg-size'

describe('svgSize', () => {
  it('reads plain pixel dimensions off the root element', () => {
    expect(svgSize('<svg width="640" height="480"></svg>')).toEqual({ width: 640, height: 480 })
    expect(svgSize('<svg width="640px" height="480px"/>')).toEqual({ width: 640, height: 480 })
  })

  it('converts the absolute CSS units a drawing program writes', () => {
    // Illustrator and Inkscape both export in points or millimetres; a file that
    // says 72pt is 96 pixels, and rasterising it at 72 would be a quarter of the
    // resolution the author chose.
    expect(svgSize('<svg width="72pt" height="36pt"/>')).toEqual({ width: 96, height: 48 })
    expect(svgSize('<svg width="1in" height="0.5in"/>')).toEqual({ width: 96, height: 48 })
    expect(svgSize('<svg width="25.4mm" height="12.7mm"/>')).toEqual({ width: 96, height: 48 })
    expect(svgSize('<svg width="2.54cm" height="1.27cm"/>')).toEqual({ width: 96, height: 48 })
  })

  it('falls back to the viewBox when the dimensions are relative or missing', () => {
    // A percentage is a share of a viewport this file has no viewport for. The
    // viewBox is the only thing left that says what shape the drawing is.
    expect(svgSize('<svg width="100%" height="100%" viewBox="0 0 800 600"/>')).toEqual({
      width: 800,
      height: 600,
    })
    expect(svgSize('<svg viewBox="0 0 800 600"/>')).toEqual({ width: 800, height: 600 })
    expect(svgSize('<svg viewBox="10 20 800 600"/>')).toEqual({ width: 800, height: 600 })
  })

  it('completes a half-specified size from the viewBox ratio', () => {
    // One axis given and one missing is how a hand-edited file usually looks;
    // the viewBox supplies the proportions the other axis follows.
    expect(svgSize('<svg width="400" viewBox="0 0 800 600"/>')).toEqual({
      width: 400,
      height: 300,
    })
    expect(svgSize('<svg height="300" viewBox="0 0 800 600"/>')).toEqual({
      width: 400,
      height: 300,
    })
  })

  it('answers the replaced-element default when the file says nothing at all', () => {
    // 300 x 150 is what every browser gives an <img> whose SVG declares no size.
    // Matching it means our raster looks like the one the user already saw.
    expect(svgSize('<svg xmlns="http://www.w3.org/2000/svg"><rect/></svg>')).toEqual(
      DEFAULT_SVG_SIZE,
    )
  })

  it('is not fooled by attributes on the shapes inside', () => {
    const source =
      '<?xml version="1.0"?>\n<!-- width="1" -->\n' +
      '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 40 20">' +
      '<rect width="1000" height="1000"/></svg>'

    expect(svgSize(source)).toEqual({ width: 40, height: 20 })
  })

  it('refuses something that is not an SVG at all', () => {
    expect(() => svgSize('<html><body>not a drawing</body></html>')).toThrow(/not an SVG/)
    expect(() => svgSize('')).toThrow(/not an SVG/)
  })
})

describe('sizedSvg', () => {
  it('rewrites the root dimensions to the raster size that was asked for', () => {
    const out = sizedSvg('<svg width="100" height="50" viewBox="0 0 100 50"><g/></svg>', {
      width: 800,
      height: 400,
    })

    expect(out).toContain('width="800"')
    expect(out).toContain('height="400"')
    expect(out).not.toContain('width="100"')
    expect(out).toContain('<g/>')
  })

  it('adds a viewBox when the file had none, so the drawing scales instead of being cropped', () => {
    // Without a viewBox, growing width and height enlarges the canvas and leaves
    // the artwork at its original size in the corner of it.
    const out = sizedSvg('<svg width="100" height="50"><g/></svg>', { width: 400, height: 200 })

    expect(out).toContain('viewBox="0 0 100 50"')
  })

  it('leaves an existing viewBox exactly as the author wrote it', () => {
    const out = sizedSvg('<svg viewBox="10 20 100 50"/>', { width: 400, height: 200 })

    expect(out).toContain('viewBox="10 20 100 50"')
  })

  it('keeps every other attribute on the root element', () => {
    const out = sizedSvg(
      '<svg xmlns="http://www.w3.org/2000/svg" class="logo" width="10" height="10"/>',
      { width: 64, height: 64 },
    )

    expect(out).toContain('xmlns="http://www.w3.org/2000/svg"')
    expect(out).toContain('class="logo"')
  })

  it('keeps a self-closing root closed', () => {
    const out = sizedSvg('<svg width="10" height="10"/>', { width: 64, height: 64 })

    expect(out.trimEnd().endsWith('/>')).toBe(true)
  })
})
