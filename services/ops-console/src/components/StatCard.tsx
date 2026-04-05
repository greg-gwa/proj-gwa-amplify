'use client'

import React from 'react'
import { useStyletron } from 'baseui'
import { colors } from '@/theme/customTheme'

interface StatCardProps {
  label: string
  value: string | number
  detail?: string
  color?: string
}

export function StatCard({ label, value, detail, color }: StatCardProps) {
  const [css] = useStyletron()

  return (
    <div
      className={css({
        backgroundColor: colors.bgElevated,
        borderRadius: '12px',
        padding: '20px 24px',
        border: `1px solid ${colors.border}`,
        flex: '1 1 180px',
        minWidth: '180px',
      })}
    >
      <div
        className={css({
          fontSize: '13px',
          fontWeight: 500,
          color: colors.textMuted,
          marginBottom: '8px',
          textTransform: 'uppercase',
          letterSpacing: '0.05em',
        })}
      >
        {label}
      </div>
      <div
        className={css({
          fontSize: '28px',
          fontWeight: 700,
          color: color || colors.textPrimary,
          lineHeight: 1.1,
        })}
      >
        {value}
      </div>
      {detail && (
        <div
          className={css({
            fontSize: '12px',
            color: colors.textMuted,
            marginTop: '6px',
          })}
        >
          {detail}
        </div>
      )}
    </div>
  )
}
