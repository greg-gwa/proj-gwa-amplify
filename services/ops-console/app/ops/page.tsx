'use client'

import React, { useEffect, useState } from 'react'
import { useStyletron } from 'baseui'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, timeAgo } from '@/lib/format'

interface Stats {
  emails_today: number
  buys_today: number
  clips_today: number
  review_queue_count: number
  weekly_spend: number
  recent_activity: Array<{
    type: string
    id: string
    timestamp: string
    summary: string
  }>
}

export default function DashboardPage() {
  const [css] = useStyletron()
  const [stats, setStats] = useState<Stats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch('/api/stats')
      .then((res) => {
        if (!res.ok) throw new Error('Failed to fetch')
        return res.json()
      })
      .then(setStats)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  if (error) {
    return (
      <div>
        <PageHeader title="Dashboard" subtitle="Amplify operations overview" />
        <div className={css({ color: colors.error, fontSize: '14px' })}>
          Error loading dashboard: {error}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Dashboard" subtitle="Amplify operations overview" />

      {/* Stat Cards */}
      <div
        className={css({
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '32px',
        })}
      >
        <StatCard
          label="Emails Today"
          value={loading ? '—' : stats?.emails_today ?? 0}
        />
        <StatCard
          label="Buys Today"
          value={loading ? '—' : stats?.buys_today ?? 0}
          color={colors.primary}
        />
        <StatCard
          label="Clips Today"
          value={loading ? '—' : stats?.clips_today ?? 0}
        />
        <StatCard
          label="Review Queue"
          value={loading ? '—' : stats?.review_queue_count ?? 0}
          color={(stats?.review_queue_count ?? 0) > 0 ? colors.warning : undefined}
        />
        <StatCard
          label="Spend This Week"
          value={loading ? '—' : formatCurrency(stats?.weekly_spend)}
          color={colors.success}
        />
      </div>

      {/* Pipeline Health */}
      <div
        className={css({
          display: 'flex',
          gap: '24px',
          marginBottom: '32px',
        })}
      >
        <div
          className={css({
            flex: 1,
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
            padding: '20px 24px',
          })}
        >
          <h3
            className={css({
              fontSize: '14px',
              fontWeight: 600,
              color: colors.textPrimary,
              marginBottom: '16px',
            })}
          >
            Pipeline Health
          </h3>
          <div className={css({ display: 'flex', gap: '24px' })}>
            <PipelineIndicator label="Email Ingestion" status="healthy" />
            <PipelineIndicator label="Buy Parsing" status="healthy" />
            <PipelineIndicator label="Clip Processing" status="healthy" />
            <PipelineIndicator label="FCC Radar" status="healthy" />
          </div>
        </div>
      </div>

      {/* Recent Activity */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          padding: '20px 24px',
        })}
      >
        <h3
          className={css({
            fontSize: '14px',
            fontWeight: 600,
            color: colors.textPrimary,
            marginBottom: '16px',
          })}
        >
          Recent Activity
        </h3>
        {loading ? (
          <div className={css({ color: colors.textMuted, fontSize: '13px' })}>Loading...</div>
        ) : (stats?.recent_activity?.length ?? 0) === 0 ? (
          <div className={css({ color: colors.textMuted, fontSize: '13px' })}>
            No recent activity
          </div>
        ) : (
          <div className={css({ display: 'flex', flexDirection: 'column', gap: '8px' })}>
            {stats?.recent_activity.map((item, i) => (
              <div
                key={`${item.id}-${i}`}
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px 0',
                  borderBottom: i < (stats.recent_activity.length - 1) ? `1px solid ${colors.border}` : 'none',
                })}
              >
                <StatusTag status={item.type === 'buy' ? 'active' : 'new'} />
                <span className={css({ fontSize: '13px', color: colors.textPrimary, flex: 1 })}>
                  {item.summary}
                </span>
                <span className={css({ fontSize: '12px', color: colors.textMuted, whiteSpace: 'nowrap' })}>
                  {timeAgo(item.timestamp)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function PipelineIndicator({ label, status }: { label: string; status: 'healthy' | 'warning' | 'error' }) {
  const [css] = useStyletron()
  const statusColor = status === 'healthy' ? colors.success : status === 'warning' ? colors.warning : colors.error

  return (
    <div className={css({ display: 'flex', alignItems: 'center', gap: '8px' })}>
      <div
        className={css({
          width: '8px',
          height: '8px',
          borderRadius: '50%',
          backgroundColor: statusColor,
        })}
      />
      <span className={css({ fontSize: '13px', color: colors.textSecondary })}>{label}</span>
    </div>
  )
}
