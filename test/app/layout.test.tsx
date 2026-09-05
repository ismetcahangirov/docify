import type { ReactElement } from 'react'

import { render, screen, within } from '@testing-library/react'
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

// The analytics reads `usePathname`, which needs a Next router. It renders
// nothing and is asserted in its own suite; here it only has to stay out of
// the way of the site frame.
vi.mock('@/components/analytics/page-view', () => ({ PageView: () => null }))

const { archivo, inter, jetbrainsMono } = await import('@/app/fonts')
const { default: RootLayout, metadata } = await import('@/app/layout')

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

describe('the site frame (issue #267)', () => {
  /*
   * `<html>` and `<body>` cannot be mounted inside a test container, so the
   * body's children are rendered on their own — which is exactly the part of
   * the layout that every page shares.
   */
  function renderFrame() {
    const html = renderRootLayout() as ReactElement<{
      children: ReactElement<{ children: unknown }>
    }>
    const body = html.props.children

    return render(<>{body.props.children as React.ReactNode}</>)
  }

  it('puts a header with the wordmark linking home on every page', () => {
    renderFrame()

    const header = screen.getByRole('banner')
    const home = within(header).getByRole('link', { name: /docify/i })

    expect(home).toHaveAttribute('href', '/')
  })

  it('links the header to the catalogue with a plain anchor', () => {
    renderFrame()

    const header = screen.getByRole('banner')

    expect(within(header).getByRole('link', { name: /converters/i })).toHaveAttribute(
      'href',
      '/convert',
    )
  })

  it('closes every page with a footer that repeats the privacy claim', () => {
    renderFrame()

    const footer = screen.getByRole('contentinfo')

    expect(footer).toHaveTextContent(/docify/i)
    expect(footer).toHaveTextContent(/(never|nothing|no) .*(upload|leaves|sent)/i)
    expect(within(footer).getByRole('link', { name: /converters/i })).toHaveAttribute(
      'href',
      '/convert',
    )
    expect(within(footer).getByRole('link', { name: /llms/i })).toHaveAttribute('href', '/llms.txt')
  })

  it('links nowhere off the site', () => {
    renderFrame()

    for (const link of screen.getAllByRole('link')) {
      expect(link.getAttribute('href')).toMatch(/^\//)
    }
  })
})

describe('the root metadata', () => {
  it('claims no Search Console property when the build has no token', () => {
    // The state of every local build and every preview deployment. A tag here
    // would be an ownership claim made by a deployment that does not own the
    // property; the shape of the value when a token *is* set is covered in
    // test/seo/verification.test.ts, which can vary the environment.
    expect(process.env.GOOGLE_SITE_VERIFICATION).toBeUndefined()
    expect(metadata.verification).toBeUndefined()
  })
})
