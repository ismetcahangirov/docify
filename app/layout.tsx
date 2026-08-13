import type { Metadata } from 'next'
import type { ReactNode } from 'react'

import './globals.css'

export const metadata: Metadata = {
  title: 'Docify',
  description: 'Convert any file — entirely in your browser. No upload, no sign-up.',
}

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-white text-black antialiased">{children}</body>
    </html>
  )
}
