'use client'

import React from 'react'
import { useStyletron } from 'baseui'
import { Sidebar } from '@/components/Sidebar'
import { colors } from '@/theme/customTheme'

export default function OpsLayout({ children }: { children: React.ReactNode }) {
  const [css] = useStyletron()

  return (
    <div className={css({ display: 'flex', height: '100vh', width: '100vw' })}>
      <Sidebar />
      <main
        className={css({
          flex: 1,
          display: 'flex',
          flexDirection: 'column',
          overflow: 'auto',
          backgroundColor: colors.bgSecondary,
        })}
      >
        <div
          className={css({
            padding: '24px 32px',
            flex: 1,
          })}
        >
          {children}
        </div>
      </main>
    </div>
  )
}
