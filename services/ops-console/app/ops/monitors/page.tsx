'use client'

import React, { useEffect, useState } from 'react'
import { useStyletron } from 'baseui'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatCard } from '@/components/StatCard'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'

interface Monitor {
  id: string
  station_call_sign: string
  spender_name: string
  daypart: string
  time_start: string
  time_end: string
  days: string
  spot_length: number
  flight_start: string
  flight_end: string
  status: string
  market_name: string
  matches_found: number
}

interface Stats {
  total_windows: number
  stations: number
  spenders: number
  active_now: number
}

export default function MonitorsPage() {
  const [css] = useStyletron()
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [stats, setStats] = useState<Stats>({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch('/api/monitors?active=true')
      .then(r => r.json())
      .then(data => {
        setMonitors(data.data || [])
        if (data.stats) setStats(data.stats)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  const columns = [
    {
      header: 'Station',
      id: 'station',
      width: '100px',
      render: (row: Monitor) => row.station_call_sign,
    },
    {
      header: 'Market',
      id: 'market',
      width: '180px',
      render: (row: Monitor) => (
        <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' })}>
          {row.market_name || '—'}
        </span>
      ),
    },
    {
      header: 'Spender',
      id: 'spender',
      width: '200px',
      render: (row: Monitor) => (
        <span className={css({ fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' })}>
          {row.spender_name}
        </span>
      ),
    },
    {
      header: 'Daypart',
      id: 'daypart',
      width: '180px',
      render: (row: Monitor) => (
        <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' })}>
          {row.daypart || '—'}
        </span>
      ),
    },
    {
      header: 'Window',
      id: 'window',
      width: '110px',
      render: (row: Monitor) => `${row.time_start}–${row.time_end}`,
    },
    {
      header: 'Days',
      id: 'days',
      width: '80px',
      render: (row: Monitor) => row.days,
    },
    {
      header: 'Length',
      id: 'length',
      width: '60px',
      render: (row: Monitor) => `:${row.spot_length}`,
    },
    {
      header: 'Flight',
      id: 'flight',
      width: '150px',
      render: (row: Monitor) => `${row.flight_start} → ${row.flight_end}`,
    },
    {
      header: 'Found',
      id: 'found',
      width: '60px',
      render: (row: Monitor) => (
        <span className={css({ color: Number(row.matches_found) > 0 ? colors.success : colors.textMuted })}>
          {row.matches_found}
        </span>
      ),
    },
    {
      header: 'Status',
      id: 'status',
      width: '80px',
      render: (row: Monitor) => <StatusTag status={row.status} />,
    },
  ]

  return (
    <div>
      <PageHeader
        title="Monitors"
        subtitle={`Active monitoring windows — what Critical Mention should be searching for`}
      />

      <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
        <StatCard label="Total Windows" value={String(Number(stats.total_windows))} />
        <StatCard label="Active Now" value={String(Number(stats.active_now))} color={colors.primary} />
        <StatCard label="Stations" value={String(Number(stats.stations))} />
        <StatCard label="Spenders" value={String(Number(stats.spenders))} />
      </div>

      <DataTable data={monitors} columns={columns} loading={loading} emptyMessage="No active monitoring windows" />
    </div>
  )
}
