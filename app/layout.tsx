import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import { fontVariables } from './fonts'

import './globals.css'

export const metadata: Metadata = {
  title: 'Docify',
  description: 'Convert any file — entirely in your browser. No upload, no sign-up.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    // The font variables live on <html> rather than <body> so that the theme
    // tokens in app/globals.css — which are declared on :root — can resolve them.
    <html lang="en" className={fontVariables}>
      <body className="min-h-dvh bg-white text-black antialiased">{children}</body>
    </html>
  )
}
