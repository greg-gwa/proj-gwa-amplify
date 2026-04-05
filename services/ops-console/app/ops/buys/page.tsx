'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { useRouter } from 'next/navigation'
import { Input, SIZE as INPUT_SIZE } from 'baseui/input'
import { Select, SIZE } from 'baseui/select'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate, formatPercent } from '@/lib/format'

interface Buy {
  id: string
  estimate_number: string
  spender_name: string
  agency: string
  flight_start: string
  flight_end: string
  total_dollars: number
  extraction_confidence: number
  status: string
  created_at: string
  stations_count: number
}

const statusOptions = [
  { id: '', label: 'All Statuses' },
  { id: 'pending', label: 'Pending' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'active', label: 'Active' },
  { id: 'revision', label: 'Revision' },
  { id: 'low_confidence', label: 'Low Confidence' },
]

export default function BuysPage() {
  const [css] = useStyletron()
  const router = useRouter()
  const [buys, setBuys] = useState<Buy[]>([])
  const [loading, setLoading] = useState(true)
  const [spenderFilter, setSpenderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<Array<{ id: string }>>([])

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (spenderFilter) params.set('spender', spenderFilter)
    const status = statusFilter[0]?.id
    if (status) params.set('status', status)
    fetch(`/api/buys?${params}`)
      .then((r) => r.json())
      .then((data) => setBuys(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [spenderFilter, statusFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const columns = [
    {
      header: 'Date',
      id: 'date',
      render: (row: Buy) => formatDate(row.created_at),
      width: '100px',
    },
    {
      header: 'Est #',
      id: 'estimate',
      render: (row: Buy) => (
        <span className={css({ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' })}>
          {row.estimate_number || '—'}
        </span>
      ),
      width: '90px',
    },
    {
      header: 'Spender',
      id: 'spender',
      render: (row: Buy) => (
        <span className={css({ fontWeight: 500 })}>{row.spender_name || '—'}</span>
      ),
    },
    {
      header: 'Agency',
      id: 'agency',
      render: (row: Buy) => row.agency || '—',
    },
    {
      header: 'Flight',
      id: 'flight',
      render: (row: Buy) =>
        `${formatDate(row.flight_start)} – ${formatDate(row.flight_end)}`,
    },
    {
      header: 'Stations',
      id: 'stations',
      render: (row: Buy) => row.stations_count ?? 0,
      width: '80px',
    },
    {
      header: 'Total',
      id: 'total',
      render: (row: Buy) => (
        <span className={css({ fontWeight: 600 })}>{formatCurrency(row.total_dollars)}</span>
      ),
      width: '110px',
    },
    {
      header: 'Conf.',
      id: 'confidence',
      render: (row: Buy) => {
        const pct = row.extraction_confidence ?? 0
        const color = pct >= 0.8 ? colors.success : pct >= 0.5 ? colors.warning : colors.error
        return <span className={css({ color, fontWeight: 600 })}>{formatPercent(pct)}</span>
      },
      width: '70px',
    },
    {
      header: 'Status',
      id: 'status',
      render: (row: Buy) => <StatusTag status={row.status} />,
      width: '130px',
    },
  ]

  return (
    <div>
      <PageHeader title="Buys" subtitle="All political ad buys" />

      <div className={css({ display: 'flex', gap: '12px', marginBottom: '16px' })}>
        <div className={css({ width: '260px' })}>
          <Input
            value={spenderFilter}
            onChange={(e) => setSpenderFilter((e.target as HTMLInputElement).value)}
            placeholder="Search spender..."
            size={INPUT_SIZE.compact}
            clearable
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
        <div className={css({ width: '200px' })}>
          <Select
            options={statusOptions}
            value={statusFilter}
            placeholder="Status"
            onChange={({ value }) => setStatusFilter(value as Array<{ id: string }>)}
            clearable
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
      </div>

      <DataTable
        data={buys}
        columns={columns}
        loading={loading}
        emptyMessage="No buys found"
        onRowClick={(row) => router.push(`/ops/buys/${row.id}`)}
      />
    </div>
  )
}
