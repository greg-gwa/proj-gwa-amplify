'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { useRouter } from 'next/navigation'
import { Button, KIND, SIZE } from 'baseui/button'
import { Select } from 'baseui/select'
import { Input } from 'baseui/input'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate, formatDateTime } from '@/lib/format'

interface RadarItem {
  id: string
  spender_name: string
  station_call_sign: string
  market_name: string
  detected_at: string
  flight_start: string
  flight_end: string
  total_dollars: number
  status: string
  document_type: string | null
  matched_buy_id: string | null
  created_at: string
  filing_url: string
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

const statusOptions = [
  { id: '', label: 'All Statuses' },
  { id: 'new', label: 'New' },
  { id: 'matched_to_buy', label: 'Matched to Buy' },
  { id: 'expired', label: 'Expired' },

]

const timeOptions = [
  { id: '', label: 'All Time' },
  { id: '48h', label: 'Last 48 Hours' },
  { id: '7d', label: 'Last Week' },
  { id: '30d', label: 'Last 30 Days' },
  { id: '90d', label: 'Last 90 Days' },
]

const docTypeOptions = [
  { id: '', label: 'All Types' },
  { id: 'CONTRACT', label: 'Contract/Order' },
  { id: 'INVOICE', label: 'Invoice' },
  { id: 'NAB_FORM', label: 'NAB Form' },
  { id: 'OTHER', label: 'Other' },
  { id: 'UNCLASSIFIED', label: 'Not Yet Parsed' },
]

export default function RadarPage() {
  const [css] = useStyletron()
  const router = useRouter()
  const [items, setItems] = useState<RadarItem[]>([])
  const [loading, setLoading] = useState(true)
  const [statusFilter, setStatusFilter] = useState<Array<{ id: string }>>([])
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [sortBy, setSortBy] = useState('detected_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')
  const [timeFilter, setTimeFilter] = useState<Array<{ id: string }>>([])
  const [docTypeFilter, setDocTypeFilter] = useState<Array<{ id: string }>>([{ id: 'CONTRACT' }])
  const [marketFilter, setMarketFilter] = useState<Array<{ id: string; label?: string }>>([])
  const [marketOptions, setMarketOptions] = useState<Array<{ id: string; label: string }>>([])
  const [marketSearch, setMarketSearch] = useState('') 

  // Load market options for the market selector
  useEffect(() => {
    const q = marketSearch || ''
    fetch(`/api/markets?search=${encodeURIComponent(q)}`)
      .then(r => r.json())
      .then(data => {
        setMarketOptions((data.data || []).map((m: any) => ({
          id: m.id,
          label: `${m.dma_name} (${m.station_count} stations)`,
        })))
      })
      .catch(console.error)
  }, [marketSearch])

  const fetchData = useCallback((p: number, status?: string, q?: string, sort?: string, dir?: string) => {
    setLoading(true)
    const params = new URLSearchParams()
    params.set('page', String(p))
    params.set('limit', '20')
    if (status) params.set('status', status)
    if (q) params.set('search', q)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    const time = timeFilter[0]?.id
    if (time) params.set('time', time)
    const docType = docTypeFilter[0]?.id
    if (docType) params.set('doc_type', docType)
    const marketIds = marketFilter.map(m => m.id).filter(Boolean)
    if (marketIds.length > 0) params.set('market_ids', marketIds.join(','))
    fetch(`/api/radar?${params}`)
      .then((r) => r.json())
      .then((data) => {
        setItems(data.data || [])
        if (data.pagination) setPagination(data.pagination)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [timeFilter, docTypeFilter, marketFilter])

  useEffect(() => {
    fetchData(1, undefined, undefined, sortBy, sortDir)
  }, [fetchData, sortBy, sortDir])

  useEffect(() => {
    const status = statusFilter[0]?.id
    setPage(1)
    fetchData(1, status || undefined, search || undefined, sortBy, sortDir)
  }, [statusFilter, search, fetchData, sortBy, sortDir, timeFilter, docTypeFilter, marketFilter])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    const status = statusFilter[0]?.id
    fetchData(newPage, status || undefined, search || undefined, sortBy, sortDir)
  }

  const handleSort = (columnId: string) => {
    if (sortBy === columnId) {
      setSortDir(sortDir === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(columnId)
      setSortDir('desc')
    }
    setPage(1)
  }

  const sortIndicator = (columnId: string) => {
    if (sortBy !== columnId) return ' ↕'
    return sortDir === 'asc' ? ' ↑' : ' ↓'
  }

  const handleSearch = () => {
    setSearch(searchInput)
  }

  const sortableHeader = (label: string, columnId: string) => (
    <span
      onClick={() => handleSort(columnId)}
      className={css({ cursor: 'pointer', userSelect: 'none', ':hover': { color: colors.primary } })}
    >
      {label}{sortIndicator(columnId)}
    </span>
  )

  const truncCell = (text: string | null | undefined) => (
    <span className={css({ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
      {text || '—'}
    </span>
  )

  const columns = [
    {
      header: sortableHeader('Spender', 'spender_name'),
      id: 'spender',
      width: '240px',
      render: (row: RadarItem) => (
        <span
          onClick={(e) => {
            e.stopPropagation()
            if (row.spender_name) router.push(`/ops/spenders/${encodeURIComponent(row.spender_name)}`)
          }}
          className={css({
            fontWeight: 500,
            display: 'block',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            whiteSpace: 'nowrap',
            color: row.spender_name ? colors.primary : colors.textPrimary,
            cursor: row.spender_name ? 'pointer' : 'default',
            ':hover': row.spender_name ? { textDecoration: 'underline' } : {},
          })}
        >
          {row.spender_name || '—'}
        </span>
      ),
    },
    {
      header: sortableHeader('Station', 'station_call_sign'),
      id: 'station',
      width: '100px',
      render: (row: RadarItem) => truncCell(row.station_call_sign),
    },
    {
      header: sortableHeader('Market', 'market_name'),
      id: 'market',
      width: '160px',
      render: (row: RadarItem) => truncCell(row.market_name),
    },
    {
      header: sortableHeader('Filed', 'detected_at'),
      id: 'filing_date',
      width: '100px',
      render: (row: RadarItem) => truncCell(formatDateTime(row.detected_at)),
    },
    {
      header: sortableHeader('Flight', 'flight_start'),
      id: 'flight',
      width: '160px',
      render: (row: RadarItem) => truncCell(
        row.flight_start ? `${formatDate(row.flight_start)} – ${formatDate(row.flight_end)}` : null
      ),
    },
    {
      header: sortableHeader('Dollars', 'total_dollars'),
      id: 'dollars',
      width: '110px',
      render: (row: RadarItem) => truncCell(row.total_dollars ? formatCurrency(row.total_dollars) : null),
    },
    {
      header: 'Type',
      id: 'document_type',
      width: '90px',
      render: (row: RadarItem) => {
        const t = row.document_type
        if (!t) return truncCell(null)
        const labels: Record<string, string> = { CONTRACT: 'Contract', ORDER: 'Order', INVOICE: 'Invoice', NAB_FORM: 'NAB', OTHER: 'Other', DOWNLOAD_FAILED: 'Failed', PARSE_ERROR: 'Error' }
        return truncCell(labels[t] || t)
      },
    },
    {
      header: 'Status',
      id: 'status',
      width: '100px',
      render: (row: RadarItem) => (
        row.matched_buy_id ? (
          <span onClick={() => router.push(`/ops/buys/${row.matched_buy_id}`)} className={css({ cursor: 'pointer' })}>
            <StatusTag status={row.status} />
          </span>
        ) : (
          <StatusTag status={row.status} />
        )
      ),
    },
    {
      header: 'Actions',
      id: 'actions',
      width: '180px',
      render: (row: RadarItem) => (
        <div className={css({ display: 'flex', gap: '4px' })}>
          {row.filing_url && (
            <Button kind={KIND.tertiary} size={SIZE.mini} onClick={() => window.open(row.filing_url, '_blank')}>
              PDF
            </Button>
          )}

        </div>
      ),
    },
  ]

  return (
    <div>
      <PageHeader
        title="Radar"
        subtitle={`FCC political filings — ${pagination.total.toLocaleString()} total`}
      />

      {/* Filters row */}
      <div className={css({ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' })}>
        <div className={css({ width: '180px' })}>
          <Select
            options={statusOptions}
            value={statusFilter}
            placeholder="Filter by status"
            onChange={({ value }) => setStatusFilter(value as Array<{ id: string }>)}
            clearable
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
        <div className={css({ width: '180px' })}>
          <Select
            options={timeOptions}
            value={timeFilter}
            placeholder="Time range"
            onChange={({ value }) => { setTimeFilter(value as Array<{ id: string }>); setPage(1) }}
            clearable
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
        <div className={css({ width: '180px' })}>
          <Select
            options={docTypeOptions}
            value={docTypeFilter}
            placeholder="Document type"
            onChange={({ value }) => { setDocTypeFilter(value as Array<{ id: string }>); setPage(1) }}
            clearable
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
        <div className={css({ width: '300px' })}>
          <Select
            options={marketOptions}
            value={marketFilter}
            placeholder="Markets (DMA)"
            onChange={({ value }) => { setMarketFilter(value as Array<{ id: string; label?: string }>); setPage(1) }}
            onInputChange={(e) => setMarketSearch((e.target as HTMLInputElement).value)}
            clearable
            multi
            size={SIZE.compact}
            type="search"
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
              MultiValue: { style: { fontSize: '12px' } },
            }}
          />
        </div>
        <div className={css({ width: '250px' })}>
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput((e.target as HTMLInputElement).value)}
            onKeyDown={(e) => { if (e.key === 'Enter') handleSearch() }}
            placeholder="Search spender, station, or market..."
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgElevated } },
            }}
          />
        </div>
        <Button kind={KIND.secondary} size={SIZE.compact} onClick={handleSearch}>
          Search
        </Button>
      </div>

      <DataTable data={items} columns={columns} loading={loading} emptyMessage="No radar items" />

      {/* Pagination */}
      {pagination.totalPages > 1 && (
        <div className={css({
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginTop: '16px',
          padding: '12px 0',
        })}>
          <span className={css({ fontSize: '13px', color: colors.textMuted })}>
            Showing {((page - 1) * pagination.limit) + 1}–{Math.min(page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
          </span>
          <div className={css({ display: 'flex', gap: '4px' })}>
            <Button
              kind={KIND.secondary}
              size={SIZE.compact}
              disabled={page <= 1}
              onClick={() => handlePageChange(page - 1)}
            >
              ← Prev
            </Button>
            <span className={css({
              display: 'flex', alignItems: 'center', padding: '0 12px',
              fontSize: '13px', color: colors.textSecondary,
            })}>
              Page {page} of {pagination.totalPages}
            </span>
            <Button
              kind={KIND.secondary}
              size={SIZE.compact}
              disabled={page >= pagination.totalPages}
              onClick={() => handlePageChange(page + 1)}
            >
              Next →
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
