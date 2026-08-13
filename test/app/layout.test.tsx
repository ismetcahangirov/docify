import type { ReactElement } from 'react'

import { describe, expect, it, vi } from 'vitest'

interface LocalFontOptions {
  variable: string
}

// See test/app/fonts.test.ts — `next/font/local` only exists inside a Next build.
vi.mock('next/font/local', () => ({
  default: (options: LocalFontOptions) => ({
    className: `classname-${options.variable}`,
    variable: `variable-${options.variable}`,
    style: { fontFamily: options.variable },
  }),
}))

const { archivo, inter, jetbrainsMono } = await import('@/app/fonts')
const { default: RootLayout } = await import('@/app/layout')

// RootLayout renders <html>/<body>, which Testing Library cannot mount inside a
// container, so the returned element is inspected directly.
function renderRootLayout(): ReactElement<{ className?: string }> {
  return RootLayout({ children: null }) as ReactElement<{ className?: string }>
}

describe('RootLayout', () => {
  // The variables have to sit on <html>, not <body>: the @theme tokens in
  // app/globals.css are declared on :root, so a <body> className would leave
  // --font-display and friends resolving to their fallbacks with no error.
  it('puts every font variable on <html> so the :root tokens can resolve them', () => {
    const html = renderRootLayout()

    expect(html.type).toBe('html')

    const classNames = html.props.className?.split(' ') ?? []

    expect(classNames).toContain(archivo.variable)
    expect(classNames).toContain(inter.variable)
    expect(classNames).toContain(jetbrainsMono.variable)
  })

  it('keeps the document language declaration', () => {
    const html = renderRootLayout() as ReactElement<{ lang?: string }>

    expect(html.props.lang).toBe('en')
  })
})
