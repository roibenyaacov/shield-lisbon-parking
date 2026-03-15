import type { Metadata, Viewport } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'Shield Lisbon Parking',
  description: 'Weekly parking allocation for the Shield Portugal office',
  icons: { icon: '/logo.png' },
}

export const viewport: Viewport = {
  themeColor: '#2C3E50',
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
