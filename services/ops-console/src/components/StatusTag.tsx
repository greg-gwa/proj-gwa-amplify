'use client'

import React from 'react'
import { Tag } from 'baseui/tag'
import { colors } from '@/theme/customTheme'

const statusColors: Record<string, { bg: string; text: string }> = {
  new: { bg: '#dbeafe', text: '#1e40af' },
  active: { bg: '#d1fae5', text: '#065f46' },
  confirmed: { bg: '#d1fae5', text: '#065f46' },
  matched: { bg: '#d1fae5', text: '#065f46' },
  matched_to_buy: { bg: '#d1fae5', text: '#065f46' },
  pending: { bg: '#fef3c7', text: '#92400e' },
  review: { bg: '#fef3c7', text: '#92400e' },
  revision: { bg: '#fef3c7', text: '#92400e' },
  unmatched: { bg: '#fef3c7', text: '#92400e' },
  low_confidence: { bg: '#fee2e2', text: '#991b1b' },
  expired: { bg: '#f3f4f6', text: '#6b7280' },
  dismissed: { bg: '#f3f4f6', text: '#6b7280' },
  inactive: { bg: '#f3f4f6', text: '#6b7280' },
  error: { bg: '#fee2e2', text: '#991b1b' },
  missing_creative: { bg: '#dbeafe', text: '#1e40af' },
  new_spender: { bg: '#fee2e2', text: '#991b1b' },
}

interface StatusTagProps {
  status: string
  closeable?: boolean
}

export function StatusTag({ status, closeable = false }: StatusTagProps) {
  const safeStatus = status ?? 'pending'
  const colorSet = statusColors[safeStatus] || statusColors.pending
  const label = safeStatus.replace(/_/g, ' ')

  return (
    <Tag
      closeable={closeable}
      overrides={{
        Root: {
          style: {
            backgroundColor: colorSet.bg,
            borderTopLeftRadius: '6px',
            borderTopRightRadius: '6px',
            borderBottomLeftRadius: '6px',
            borderBottomRightRadius: '6px',
            marginTop: 0,
            marginBottom: 0,
            marginLeft: 0,
            marginRight: 0,
            paddingTop: '2px',
            paddingBottom: '2px',
            paddingLeft: '10px',
            paddingRight: '10px',
          },
        },
        Text: {
          style: {
            color: colorSet.text,
            fontSize: '12px',
            fontWeight: 600,
            textTransform: 'capitalize' as const,
          },
        },
      }}
    >
      {label}
    </Tag>
  )
}
