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
  markets: string | null
  fcc_filing_url: string | null
  fcc_match_count: number
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
  const [total, setTotal] = useState(0)
  const [page, setPage] = useState(0)
  const [loading, setLoading] = useState(true)
  const [spenderFilter, setSpenderFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<Array<{ id: string }>>([])
  const pageSize = 25

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (spenderFilter) params.set('spender', spenderFilter)
    const status = statusFilter[0]?.id
    if (status) params.set('status', status)
    params.set('limit', String(pageSize))
    params.set('offset', String(page * pageSize))
    fetch(`/api/buys?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setBuys(data.data || [])
        setTotal(data.total || 0)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [spenderFilter, statusFilter, page])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  // Reset to page 0 when filters change
  useEffect(() => {
    setPage(0)
  }, [spenderFilter, statusFilter])

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
      header: 'Markets',
      id: 'markets',
      render: (row: Buy) => (
        <span className={css({ fontSize: '12px', whiteSpace: 'normal', wordBreak: 'break-word', lineHeight: '1.4' })}>
          {row.markets || '—'}
        </span>
      ),
    },
    {
      header: 'Stns',
      id: 'stations',
      render: (row: Buy) => row.stations_count ?? 0,
      width: '50px',
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
      render: (row: Buy) => (
        <span className={css({ display: 'flex', alignItems: 'center', gap: '6px' })}>
          <StatusTag status={row.status} />
          {row.fcc_filing_url && (
            <a
              href={row.fcc_filing_url}
              target="_blank"
              rel="noopener noreferrer"
              title={`${row.fcc_match_count} FCC filing${row.fcc_match_count > 1 ? 's' : ''} matched`}
              onClick={(e) => e.stopPropagation()}
              className={css({
                color: colors.info || '#3b82f6',
                fontSize: '11px',
                fontWeight: 600,
                textDecoration: 'none',
                padding: '2px 6px',
                borderRadius: '4px',
                backgroundColor: 'rgba(59,130,246,0.1)',
                ':hover': { backgroundColor: 'rgba(59,130,246,0.2)' },
              })}
            >
              FCC{row.fcc_match_count > 1 ? ` (${row.fcc_match_count})` : ''}
            </a>
          )}
        </span>
      ),
      width: '160px',
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

      {total > pageSize && (
        <div className={css({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '16px',
          padding: '0 4px',
        })}>
          <span className={css({ fontSize: '13px', color: colors.textMuted })}>
            {page * pageSize + 1}–{Math.min((page + 1) * pageSize, total)} of {total}
          </span>
          <div className={css({ display: 'flex', gap: '8px' })}>
            <button
              disabled={page === 0}
              onClick={() => setPage((p) => Math.max(0, p - 1))}
              className={css({
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgElevated,
                color: page === 0 ? colors.textMuted : colors.textPrimary,
                cursor: page === 0 ? 'not-allowed' : 'pointer',
                ':hover': { backgroundColor: page === 0 ? undefined : colors.bgSecondary },
              })}
            >
              ← Prev
            </button>
            <button
              disabled={(page + 1) * pageSize >= total}
              onClick={() => setPage((p) => p + 1)}
              className={css({
                padding: '6px 14px',
                fontSize: '12px',
                fontWeight: 600,
                borderRadius: '6px',
                border: `1px solid ${colors.border}`,
                backgroundColor: colors.bgElevated,
                color: (page + 1) * pageSize >= total ? colors.textMuted : colors.textPrimary,
                cursor: (page + 1) * pageSize >= total ? 'not-allowed' : 'pointer',
                ':hover': { backgroundColor: (page + 1) * pageSize >= total ? undefined : colors.bgSecondary },
              })}
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
