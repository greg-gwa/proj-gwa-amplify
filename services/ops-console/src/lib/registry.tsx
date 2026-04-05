'use client'

import React, { useState } from 'react'
import { Provider as StyletronProvider } from 'styletron-react'
import { Client, Server } from 'styletron-engine-monolithic'
import { BaseProvider } from 'baseui'
import { customLightTheme } from '@/theme/customTheme'

const isServer = typeof window === 'undefined'

function getEngine() {
  if (isServer) {
    return new Server()
  }
  // Reuse existing client engine or create one
  const styleElements = document.querySelectorAll('._styletron_hydrate_')
  return new Client({ hydrate: styleElements as any })
}

export function StyleRegistry({ children }: { children: React.ReactNode }) {
  const [engine] = useState(() => getEngine())

  return (
    <StyletronProvider value={engine}>
      <BaseProvider theme={customLightTheme}>
        {children}
      </BaseProvider>
    </StyletronProvider>
  )
}
