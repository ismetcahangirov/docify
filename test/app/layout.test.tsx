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

const { fontVariables } = await import('@/app/fonts')
const { default: RootLayout } = await import('@/app/layout')

// RootLayout renders <html>/<body>, which Testing Library cannot mount inside a
// container, so the returned element is inspected directly.
function renderRootLayout(): ReactElement<{ className?: string }> {
  return RootLayout({ children: null }) as ReactElement<{ className?: string }>
}

describe('RootLayout', () => {
  it('puts the font variables on <html> so every subtree inherits them', () => {
    const html = renderRootLayout()

    expect(html.type).toBe('html')

    for (const variable of fontVariables.split(' ')) {
      expect(html.props.className).toContain(variable)
    }
  })

  it('keeps the document language declaration', () => {
    const html = renderRootLayout() as ReactElement<{ lang?: string }>

    expect(html.props.lang).toBe('en')
  })
})
