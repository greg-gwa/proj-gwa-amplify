import type { Metadata } from 'next'
import { StyleRegistry } from '@/lib/registry'
import './globals.css'

export const metadata: Metadata = {
  title: 'Amplify Ops Console',
  description: 'Amplify political ad tracking operations console',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <StyleRegistry>{children}</StyleRegistry>
      </body>
    </html>
  )
}
