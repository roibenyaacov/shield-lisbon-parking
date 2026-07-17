import type { Metadata, Viewport } from 'next'
import './globals.css'
import { RecoveryLinkGuard } from '@/components/auth/RecoveryLinkGuard'

export const metadata: Metadata = {
  title: 'Shield Lisbon Parking',
  description: 'Weekly parking allocation for the Shield Portugal office',
  icons: { icon: '/icon.png' },
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
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased" suppressHydrationWarning>
        <RecoveryLinkGuard />
        {children}
      </body>
    </html>
  )
}
