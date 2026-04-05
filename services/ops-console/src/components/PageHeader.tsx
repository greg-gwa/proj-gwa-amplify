'use client'

import React from 'react'
import { useStyletron } from 'baseui'
import { colors } from '@/theme/customTheme'

interface PageHeaderProps {
  title: string
  subtitle?: string
  actions?: React.ReactNode
}

export function PageHeader({ title, subtitle, actions }: PageHeaderProps) {
  const [css] = useStyletron()

  return (
    <div
      className={css({
        display: 'flex',
        alignItems: 'flex-start',
        justifyContent: 'space-between',
        marginBottom: '24px',
      })}
    >
      <div>
        <h1
          className={css({
            fontSize: '24px',
            fontWeight: 700,
            color: colors.textPrimary,
            margin: 0,
            lineHeight: 1.2,
          })}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className={css({
              fontSize: '14px',
              color: colors.textMuted,
              margin: '4px 0 0',
            })}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div>{actions}</div>}
    </div>
  )
}
