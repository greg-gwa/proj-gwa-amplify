'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useStyletron } from 'baseui'
import { Button, KIND, SIZE } from 'baseui/button'
import { Tag } from 'baseui/tag'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatCard } from '@/components/StatCard'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate, formatNumber } from '@/lib/format'

interface RadarItem {
  id: string
  station_call_sign: string
  market_name: string
  detected_at: string
  flight_start: string
  flight_end: string
  total_dollars: number
  status: string
  filing_url: string
}

interface FECData {
  committee: {
    cmte_id: string
    cmte_name: string
    cmte_type: string
    cmte_type_label: string
    cmte_party: string
    connected_org: string
    cand_id: string
    treasurer_name: string
    city: string
    state: string
  } | null
  candidate: {
    cand_id: string
    cand_name: string
    party: string
    party_full: string
    office: string
    state: string
    district: string
    election_year: number
  } | null
  stats: {
    total_raised: number
    total_spent: number
    top_donors: Array<{ name: string; total: number; employer: string; occupation: string }>
    recent_expenditures: Array<{ vendor: string; amount: number; purpose: string; date: string }>
  } | null
}

interface FilingsData {
  items: RadarItem[]
  total: number
  stations: number
  markets: number
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function SpenderDetailPage() {
  const params = useParams()
  const router = useRouter()
  const [css] = useStyletron()
  const spenderName = decodeURIComponent(params.name as string)

  const [fecData, setFecData] = useState<FECData | null>(null)
  const [fecLoading, setFecLoading] = useState(true)
  const [filingsData, setFilingsData] = useState<FilingsData | null>(null)
  const [filingsLoading, setFilingsLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 20, total: 0, totalPages: 0 })
  const [sortBy, setSortBy] = useState('detected_at')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc')

  // Fetch FEC data
  useEffect(() => {
    setFecLoading(true)
    fetch(`/api/fec?name=${encodeURIComponent(spenderName)}`)
      .then((r) => r.json())
      .then(setFecData)
      .catch(console.error)
      .finally(() => setFecLoading(false))
  }, [spenderName])

  // Fetch filings from radar_items
  const fetchFilings = useCallback(
    (p: number, sort?: string, dir?: string) => {
      setFilingsLoading(true)
      const params = new URLSearchParams()
      params.set('page', String(p))
      params.set('limit', '20')
      params.set('search', spenderName)
      if (sort) params.set('sort', sort)
      if (dir) params.set('dir', dir)
      fetch(`/api/radar?${params}`)
        .then((r) => r.json())
        .then((data) => {
          const items = data.data || []
          const stationSet = new Set(items.map((i: RadarItem) => i.station_call_sign))
          const marketSet = new Set(items.map((i: RadarItem) => i.market_name))
          setFilingsData({
            items,
            total: data.pagination?.total ?? items.length,
            stations: stationSet.size,
            markets: marketSet.size,
          })
          if (data.pagination) setPagination(data.pagination)
        })
        .catch(console.error)
        .finally(() => setFilingsLoading(false))
    },
    [spenderName]
  )

  useEffect(() => {
    fetchFilings(1, sortBy, sortDir)
  }, [fetchFilings, sortBy, sortDir])

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchFilings(newPage, sortBy, sortDir)
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

  const sortableHeader = (label: string, columnId: string) => (
    <span
      onClick={() => handleSort(columnId)}
      className={css({ cursor: 'pointer', userSelect: 'none', ':hover': { color: colors.primary } })}
    >
      {label}{sortIndicator(columnId)}
    </span>
  )

  const partyColor = (party: string | null | undefined) => {
    if (!party) return colors.textMuted
    const p = party.toUpperCase()
    if (p === 'DEM' || p === 'D') return '#2563eb'
    if (p === 'REP' || p === 'R') return '#dc2626'
    return colors.textMuted
  }

  const committee = fecData?.committee
  const candidate = fecData?.candidate

  const filingsColumns = [
    {
      header: sortableHeader('Station', 'station_call_sign'),
      id: 'station',
      width: '120px',
      render: (row: RadarItem) => row.station_call_sign || '—',
    },
    {
      header: sortableHeader('Market', 'market_name'),
      id: 'market',
      width: '180px',
      render: (row: RadarItem) => (
        <span className={css({ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
          {row.market_name || '—'}
        </span>
      ),
    },
    {
      header: sortableHeader('Filed', 'detected_at'),
      id: 'filing_date',
      width: '120px',
      render: (row: RadarItem) => formatDate(row.detected_at),
    },
    {
      header: sortableHeader('Flight', 'flight_start'),
      id: 'flight',
      width: '200px',
      render: (row: RadarItem) =>
        row.flight_start ? `${formatDate(row.flight_start)} – ${formatDate(row.flight_end)}` : '—',
    },
    {
      header: sortableHeader('Dollars', 'total_dollars'),
      id: 'dollars',
      width: '120px',
      render: (row: RadarItem) => (
        <span className={css({ fontWeight: 600 })}>
          {row.total_dollars ? formatCurrency(row.total_dollars) : '—'}
        </span>
      ),
    },
    {
      header: 'PDF',
      id: 'pdf',
      width: '70px',
      render: (row: RadarItem) =>
        row.filing_url ? (
          <Button kind={KIND.tertiary} size={SIZE.mini} onClick={() => window.open(row.filing_url, '_blank')}>
            PDF
          </Button>
        ) : (
          '—'
        ),
    },
  ]

  const donorColumns = [
    {
      header: 'Donor',
      id: 'name',
      render: (row: FECData['stats'] extends null ? never : NonNullable<FECData['stats']>['top_donors'][0]) => (
        <span className={css({ fontWeight: 500 })}>{row.name || '—'}</span>
      ),
    },
    {
      header: 'Total',
      id: 'total',
      width: '130px',
      render: (row: { name: string; total: number; employer: string; occupation: string }) => (
        <span className={css({ fontWeight: 600 })}>{formatCurrency(row.total)}</span>
      ),
    },
    {
      header: 'Employer',
      id: 'employer',
      render: (row: { name: string; total: number; employer: string; occupation: string }) => (
        <span className={css({ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
          {row.employer || '—'}
        </span>
      ),
    },
    {
      header: 'Occupation',
      id: 'occupation',
      render: (row: { name: string; total: number; employer: string; occupation: string }) => (
        <span className={css({ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
          {row.occupation || '—'}
        </span>
      ),
    },
  ]

  const expenditureColumns = [
    {
      header: 'Vendor',
      id: 'vendor',
      render: (row: { vendor: string; amount: number; purpose: string; date: string }) => (
        <span className={css({ fontWeight: 500 })}>{row.vendor || '—'}</span>
      ),
    },
    {
      header: 'Amount',
      id: 'amount',
      width: '130px',
      render: (row: { vendor: string; amount: number; purpose: string; date: string }) => (
        <span className={css({ fontWeight: 600 })}>{formatCurrency(row.amount)}</span>
      ),
    },
    {
      header: 'Purpose',
      id: 'purpose',
      render: (row: { vendor: string; amount: number; purpose: string; date: string }) => (
        <span className={css({ display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' })}>
          {row.purpose || '—'}
        </span>
      ),
    },
    {
      header: 'Date',
      id: 'date',
      width: '130px',
      render: (row: { vendor: string; amount: number; purpose: string; date: string }) => formatDate(row.date),
    },
  ]

  return (
    <div>
      {/* Back button */}
      <div className={css({ marginBottom: '16px' })}>
        <Button kind={KIND.tertiary} size={SIZE.compact} onClick={() => router.push('/ops/spenders')}>
          ← Back to Spenders
        </Button>
      </div>

      {/* Header section */}
      <div className={css({ marginBottom: '24px' })}>
        <div className={css({ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' })}>
          <h1
            className={css({
              fontSize: '28px',
              fontWeight: 700,
              color: colors.textPrimary,
              margin: 0,
              lineHeight: 1.2,
            })}
          >
            {spenderName}
          </h1>
          {committee && (
            <>
              <Tag
                closeable={false}
                overrides={{
                  Root: {
                    style: {
                      backgroundColor: '#e0e7ff',
                      borderRadius: '6px',
                      marginTop: '0',
                      marginBottom: '0',
                      marginLeft: '0',
                      marginRight: '0',
                    },
                  },
                  Text: {
                    style: { color: '#3730a3', fontSize: '12px', fontWeight: 600 },
                  },
                }}
              >
                {committee.cmte_type_label}
              </Tag>
              {committee.cmte_party && (
                <span
                  className={css({
                    fontSize: '14px',
                    fontWeight: 700,
                    color: partyColor(committee.cmte_party),
                  })}
                >
                  {committee.cmte_party === 'DEM' ? 'Democrat' : committee.cmte_party === 'REP' ? 'Republican' : committee.cmte_party}
                </span>
              )}
            </>
          )}
        </div>

        {/* Candidate info */}
        {candidate && (
          <div className={css({ marginTop: '8px', fontSize: '14px', color: colors.textSecondary })}>
            Connected candidate:{' '}
            <span className={css({ fontWeight: 600, color: partyColor(candidate.party) })}>
              {candidate.cand_name}
            </span>
            {' — '}
            {candidate.office === 'H' ? 'House' : candidate.office === 'S' ? 'Senate' : candidate.office === 'P' ? 'President' : candidate.office}
            {candidate.state && `, ${candidate.state}`}
            {candidate.district && `-${candidate.district}`}
            {candidate.election_year && ` (${candidate.election_year})`}
          </div>
        )}

        {/* Committee details */}
        {committee && (
          <div className={css({ marginTop: '4px', fontSize: '13px', color: colors.textMuted })}>
            FEC ID:{' '}
            <span className={css({ fontFamily: 'JetBrains Mono, monospace', fontSize: '12px' })}>
              {committee.cmte_id}
            </span>
            {committee.city && committee.state && ` · ${committee.city}, ${committee.state}`}
            {committee.treasurer_name && ` · Treasurer: ${committee.treasurer_name}`}
          </div>
        )}

        {!fecLoading && !committee && (
          <div className={css({ marginTop: '8px', fontSize: '13px', color: colors.textMuted, fontStyle: 'italic' })}>
            No FEC committee match found
          </div>
        )}
      </div>

      {/* Stats row */}
      <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
        <StatCard
          label="FCC Filings"
          value={filingsLoading ? '...' : formatNumber(filingsData?.total ?? 0)}
        />
        <StatCard
          label="Stations Active"
          value={filingsLoading ? '...' : formatNumber(filingsData?.stations ?? 0)}
        />
        <StatCard
          label="Markets Active"
          value={filingsLoading ? '...' : formatNumber(filingsData?.markets ?? 0)}
        />
        <StatCard
          label="Total Raised"
          value={fecLoading ? '...' : formatCurrency(fecData?.stats?.total_raised ?? 0)}
          color={colors.success}
        />
        <StatCard
          label="Total Spent"
          value={fecLoading ? '...' : formatCurrency(fecData?.stats?.total_spent ?? 0)}
          color={colors.primary}
        />
      </div>

      {/* Filings table */}
      <div className={css({ marginBottom: '32px' })}>
        <h2 className={css({ fontSize: '18px', fontWeight: 600, color: colors.textPrimary, marginBottom: '12px' })}>
          FCC Filings
        </h2>
        <DataTable data={filingsData?.items ?? []} columns={filingsColumns} loading={filingsLoading} emptyMessage="No filings found" />

        {pagination.totalPages > 1 && (
          <div
            className={css({
              display: 'flex',
              justifyContent: 'space-between',
              alignItems: 'center',
              marginTop: '16px',
              padding: '12px 0',
            })}
          >
            <span className={css({ fontSize: '13px', color: colors.textMuted })}>
              Showing {(page - 1) * pagination.limit + 1}–{Math.min(page * pagination.limit, pagination.total)} of{' '}
              {pagination.total.toLocaleString()}
            </span>
            <div className={css({ display: 'flex', gap: '4px' })}>
              <Button kind={KIND.secondary} size={SIZE.compact} disabled={page <= 1} onClick={() => handlePageChange(page - 1)}>
                ← Prev
              </Button>
              <span
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  padding: '0 12px',
                  fontSize: '13px',
                  color: colors.textSecondary,
                })}
              >
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

      {/* FEC Section */}
      {!fecLoading && fecData?.stats && (
        <>
          {/* Top Donors */}
          <div className={css({ marginBottom: '32px' })}>
            <h2 className={css({ fontSize: '18px', fontWeight: 600, color: colors.textPrimary, marginBottom: '12px' })}>
              Top Donors (FEC)
            </h2>
            <DataTable
              data={fecData.stats.top_donors}
              columns={donorColumns}
              emptyMessage="No donor data available"
            />
          </div>

          {/* Recent Expenditures */}
          <div className={css({ marginBottom: '32px' })}>
            <h2 className={css({ fontSize: '18px', fontWeight: 600, color: colors.textPrimary, marginBottom: '12px' })}>
              Recent Expenditures (FEC)
            </h2>
            <DataTable
              data={fecData.stats.recent_expenditures}
              columns={expenditureColumns}
              emptyMessage="No expenditure data available"
            />
          </div>
        </>
      )}

      {!fecLoading && !fecData?.stats && (
        <div
          className={css({
            padding: '32px',
            textAlign: 'center',
            color: colors.textMuted,
            fontSize: '14px',
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
          })}
        >
          No FEC data found for this spender
        </div>
      )}
    </div>
  )
}
