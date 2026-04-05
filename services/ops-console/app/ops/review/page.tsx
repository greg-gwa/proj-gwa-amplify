'use client'

import React, { useEffect, useState } from 'react'
import { useStyletron } from 'baseui'
import { Button, KIND, SIZE } from 'baseui/button'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { timeAgo } from '@/lib/format'

interface ReviewItem {
  id: string
  name: string
  review_type: string
  created_at: string
  summary: string
  suggestion: string
}

interface ReviewData {
  data: ReviewItem[]
  total: number
  counts: {
    new_spender: number
    low_confidence: number
    revision: number
    unmatched_clip: number
    missing_creative: number
  }
}

const typeLabels: Record<string, string> = {
  new_spender: 'New Spender',
  low_confidence: 'Low Confidence',
  revision: 'Revision',
  unmatched_clip: 'Unmatched Clip',
  missing_creative: 'Missing Creative',
}

const typeLinks: Record<string, string> = {
  new_spender: '/ops/spenders',
  low_confidence: '/ops/buys',
  revision: '/ops/buys',
  unmatched_clip: '/ops/clips',
  missing_creative: '/ops/buys',
}

export default function ReviewPage() {
  const [css] = useStyletron()
  const [data, setData] = useState<ReviewData | null>(null)
  const [loading, setLoading] = useState(true)
  const [filter, setFilter] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/review')
      .then((r) => r.json())
      .then((raw) => {
        // Compute counts from data items
        const items: ReviewItem[] = raw.data || []
        const counts = {
          new_spender: items.filter((i) => i.review_type === 'new_spender').length,
          low_confidence: items.filter((i) => i.review_type === 'low_confidence').length,
          revision: items.filter((i) => i.review_type === 'revision').length,
          unmatched_clip: items.filter((i) => i.review_type === 'unmatched_clip').length,
          missing_creative: items.filter((i) => i.review_type === 'missing_creative').length,
        }
        setData({ data: items, total: raw.total ?? items.length, counts })
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const filtered = filter
    ? data?.data.filter((item) => item.review_type === filter) ?? []
    : data?.data ?? []

  return (
    <div>
      <PageHeader
        title="Review Queue"
        subtitle={`${data?.total ?? 0} items needing attention`}
      />

      {/* Summary Cards */}
      <div className={css({ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' })}>
        <StatCard
          label="New Spenders"
          value={loading ? '—' : data?.counts.new_spender ?? 0}
          color={colors.error}
        />
        <StatCard
          label="Low Confidence"
          value={loading ? '—' : data?.counts.low_confidence ?? 0}
          color={colors.error}
        />
        <StatCard
          label="Revisions"
          value={loading ? '—' : data?.counts.revision ?? 0}
          color={colors.warning}
        />
        <StatCard
          label="Unmatched Clips"
          value={loading ? '—' : data?.counts.unmatched_clip ?? 0}
          color={colors.warning}
        />
        <StatCard
          label="Missing Creatives"
          value={loading ? '—' : data?.counts.missing_creative ?? 0}
          color={colors.info}
        />
      </div>

      {/* Filter Tabs */}
      <div className={css({ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' })}>
        <FilterChip label="All" active={filter === null} onClick={() => setFilter(null)} count={data?.total ?? 0} />
        {Object.entries(typeLabels).map(([key, label]) => (
          <FilterChip
            key={key}
            label={label}
            active={filter === key}
            onClick={() => setFilter(key)}
            count={(data?.counts as Record<string, number>)?.[key] ?? 0}
          />
        ))}
      </div>

      {/* Items */}
      {loading ? (
        <div className={css({ color: colors.textMuted, fontSize: '14px', textAlign: 'center', padding: '48px' })}>
          Loading...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className={css({
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
            padding: '48px',
            textAlign: 'center',
            color: colors.textMuted,
            fontSize: '14px',
          })}
        >
          No items to review
        </div>
      ) : (
        <div className={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}>
          {filtered.map((item) => (
            <div
              key={`${item.review_type}-${item.id}`}
              className={css({
                backgroundColor: colors.bgElevated,
                borderRadius: '10px',
                border: `1px solid ${colors.border}`,
                padding: '16px 20px',
                display: 'flex',
                alignItems: 'center',
                gap: '16px',
                transition: 'all 150ms ease',
                ':hover': { borderColor: colors.primary },
              })}
            >
              <StatusTag status={item.review_type} />
              <div className={css({ flex: 1, minWidth: 0 })}>
                <div className={css({ fontSize: '14px', fontWeight: 500, color: colors.textPrimary, marginBottom: '4px' })}>
                  {item.summary}
                </div>
                <div className={css({ fontSize: '12px', color: colors.textMuted, display: 'flex', gap: '12px' })}>
                  <span>AI suggestion: {item.suggestion}</span>
                  <span>·</span>
                  <span>{timeAgo(item.created_at)}</span>
                </div>
              </div>
              <div className={css({ display: 'flex', gap: '8px', flexShrink: 0 })}>
                <Button
                  kind={KIND.primary}
                  size={SIZE.mini}
                  onClick={() => {
                    const base = typeLinks[item.review_type] || '/ops'
                    window.location.href = item.review_type.includes('clip')
                      ? base
                      : `${base}/${item.id}`
                  }}
                >
                  Review
                </Button>
                <Button kind={KIND.tertiary} size={SIZE.mini}>
                  Dismiss
                </Button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function FilterChip({
  label,
  active,
  onClick,
  count,
}: {
  label: string
  active: boolean
  onClick: () => void
  count: number
}) {
  const [css] = useStyletron()

  return (
    <button
      onClick={onClick}
      className={css({
        display: 'inline-flex',
        alignItems: 'center',
        gap: '6px',
        padding: '6px 14px',
        borderRadius: '20px',
        fontSize: '13px',
        fontWeight: active ? 600 : 400,
        color: active ? '#ffffff' : colors.textSecondary,
        backgroundColor: active ? colors.primary : colors.bgElevated,
        border: `1px solid ${active ? colors.primary : colors.border}`,
        cursor: 'pointer',
        transition: 'all 150ms ease',
        ':hover': {
          borderColor: colors.primary,
        },
      })}
    >
      {label}
      <span
        className={css({
          fontSize: '11px',
          fontWeight: 600,
          backgroundColor: active ? 'rgba(255,255,255,0.2)' : colors.bgSecondary,
          color: active ? '#ffffff' : colors.textMuted,
          padding: '1px 6px',
          borderRadius: '10px',
        })}
      >
        {count}
      </span>
    </button>
  )
}
