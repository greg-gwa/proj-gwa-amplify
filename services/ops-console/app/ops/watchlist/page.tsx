'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStyletron } from 'baseui'
import { Button, KIND, SIZE } from 'baseui/button'
import { Input } from 'baseui/input'
import { Tag } from 'baseui/tag'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatCard } from '@/components/StatCard'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate } from '@/lib/format'

interface MarketOption {
  id: string
  dma_name: string
  station_count: number
}

interface SelectedMarket {
  id: string
  dma_name: string
  station_count: number
}

interface Monitor {
  id: string
  station_call_sign: string
  market_name: string
  spender_name: string
  daypart: string
  time_start: string
  time_end: string
  days: string | null
  flight_start: string
  flight_end: string
  status: string
  matches_found: number
}

interface MonitorStats {
  total_windows: number
  stations: number
  spenders: number
  active_now: number
  total_dollars?: number
}

interface Pagination {
  page: number
  limit: number
  total: number
  totalPages: number
}

export default function WatchlistPage() {
  const [css] = useStyletron()
  const [selectedMarkets, setSelectedMarkets] = useState<SelectedMarket[]>([])
  const [loading, setLoading] = useState(true)
  const [marketSearch, setMarketSearch] = useState('')
  const [marketResults, setMarketResults] = useState<MarketOption[]>([])
  const [showDropdown, setShowDropdown] = useState(false)
  const [monitors, setMonitors] = useState<Monitor[]>([])
  const [stats, setStats] = useState<MonitorStats>({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
  const [monitorsLoading, setMonitorsLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [searchInput, setSearchInput] = useState('')
  const [sortBy, setSortBy] = useState('station_call_sign')
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')
  const [page, setPage] = useState(1)
  const [pagination, setPagination] = useState<Pagination>({ page: 1, limit: 15, total: 0, totalPages: 0 })
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Load initial watchlist config (market IDs)
  const fetchConfig = useCallback(() => {
    setLoading(true)
    fetch('/api/watchlist')
      .then(r => r.json())
      .then(data => {
        if (data.data?.markets) {
          setSelectedMarkets(data.data.markets)
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchConfig()
  }, [fetchConfig])

  // Fetch monitors when selected markets change
  const fetchMonitors = useCallback((
    marketIds: string[],
    p: number,
    q?: string,
    sort?: string,
    dir?: string
  ) => {
    if (marketIds.length === 0) {
      setMonitors([])
      setStats({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
      setPagination({ page: 1, limit: 15, total: 0, totalPages: 0 })
      return
    }
    setMonitorsLoading(true)
    const params = new URLSearchParams()
    params.set('active', 'true')
    params.set('market_ids', marketIds.join(','))
    params.set('page', String(p))
    params.set('limit', '15')
    if (q) params.set('search', q)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)
    fetch(`/api/monitors?${params}`)
      .then(r => r.json())
      .then(data => {
        setMonitors(data.data || [])
        if (data.stats) setStats(data.stats)
        if (data.pagination) setPagination(data.pagination)
      })
      .catch(console.error)
      .finally(() => setMonitorsLoading(false))
  }, [])

  useEffect(() => {
    const ids = selectedMarkets.map(m => m.id)
    fetchMonitors(ids, 1, search || undefined, sortBy, sortDir)
    setPage(1)
  }, [selectedMarkets, search, sortBy, sortDir, fetchMonitors])

  // Search markets for autocomplete
  useEffect(() => {
    if (!marketSearch || marketSearch.length < 2) {
      setMarketResults([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/markets?search=${encodeURIComponent(marketSearch)}`)
        .then(r => r.json())
        .then(data => {
          if (data.data) {
            const selectedIds = selectedMarkets.map(m => m.id)
            setMarketResults(
              data.data.filter((m: MarketOption) => !selectedIds.includes(m.id))
            )
          }
        })
        .catch(console.error)
    }, 200)
    return () => clearTimeout(timer)
  }, [marketSearch, selectedMarkets])

  // Close dropdown on click outside
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setShowDropdown(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  const addMarket = async (market: MarketOption) => {
    setSelectedMarkets(prev => [...prev, { id: market.id, dma_name: market.dma_name, station_count: market.station_count }])
    setMarketSearch('')
    setShowDropdown(false)
    // Persist
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'add_market', market_id: market.id }),
    })
  }

  const removeMarket = async (marketId: string) => {
    setSelectedMarkets(prev => prev.filter(m => m.id !== marketId))
    await fetch('/api/watchlist', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'remove_market', market_id: marketId }),
    })
  }

  const handleSort = (columnId: string) => {
    if (sortBy === columnId) {
      setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    } else {
      setSortBy(columnId)
      setSortDir('asc')
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

  const handlePageChange = (newPage: number) => {
    setPage(newPage)
    fetchMonitors(selectedMarkets.map(m => m.id), newPage, search || undefined, sortBy, sortDir)
  }

  const columns = [
    {
      header: sortableHeader('Station', 'station_call_sign'),
      id: 'station',
      width: '100px',
      render: (row: Monitor) => (
        <span className={css({ fontWeight: 500, color: colors.textPrimary })}>{row.station_call_sign}</span>
      ),
    },
    {
      header: sortableHeader('Market', 'market_name'),
      id: 'market',
      width: '160px',
      render: (row: Monitor) => (
        <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block' })}>
          {row.market_name || '—'}
        </span>
      ),
    },
    {
      header: sortableHeader('Spender', 'spender_name'),
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
      width: '160px',
      render: (row: Monitor) => (
        <span className={css({ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', display: 'block', color: colors.textSecondary })}>
          {row.daypart || '—'}
        </span>
      ),
    },
    {
      header: 'Time Window',
      id: 'window',
      width: '110px',
      render: (row: Monitor) => (
        <span className={css({ color: colors.textSecondary })}>
          {row.time_start && row.time_end ? `${row.time_start}–${row.time_end}` : '—'}
        </span>
      ),
    },
    {
      header: 'Days',
      id: 'days',
      width: '80px',
      render: (row: Monitor) => {
        const d = row.days || ''
        const labels: Record<string, string> = {
          'MTWTF': 'Mon–Fri',
          'MTWTFSS': 'Daily',
          'SS': 'Weekends',
          'S': 'Sat',
          'Su': 'Sun',
        }
        return (
          <span className={css({ color: colors.textSecondary, fontSize: '12px' })}>
            {labels[d] || d || '—'}
          </span>
        )
      },
    },
    {
      header: 'Flight Dates',
      id: 'flight',
      width: '160px',
      render: (row: Monitor) => (
        <span className={css({ color: colors.textSecondary, fontSize: '12px' })}>
          {row.flight_start && row.flight_end
            ? `${formatDate(row.flight_start)} – ${formatDate(row.flight_end)}`
            : '—'}
        </span>
      ),
    },
    {
      header: 'Status',
      id: 'status',
      width: '80px',
      render: (row: Monitor) => <StatusTag status={row.status} />,
    },
    {
      header: 'Matches',
      id: 'matches_found',
      width: '80px',
      render: (row: Monitor) => (
        <span className={css({ color: Number(row.matches_found) > 0 ? colors.success : colors.textMuted, fontWeight: Number(row.matches_found) > 0 ? 600 : 400 })}>
          {row.matches_found}
        </span>
      ),
    },
  ]

  if (loading) {
    return (
      <div>
        <PageHeader title="Watchlist" subtitle="Region-based monitoring dashboard" />
        <p className={css({ color: colors.textMuted })}>Loading...</p>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Watchlist" subtitle="Region-based monitoring dashboard — pick markets, see active monitors" />

      {/* Region Picker */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          padding: '20px',
          marginBottom: '20px',
        })}
      >
        <h3 className={css({ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 12px' })}>
          Select Markets
        </h3>

        {/* Selected market chips */}
        {selectedMarkets.length > 0 && (
          <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' })}>
            {selectedMarkets.map((market) => (
              <Tag
                key={market.id}
                onActionClick={() => removeMarket(market.id)}
                closeable
                overrides={{
                  Root: {
                    style: {
                      backgroundColor: '#1a365d',
                      borderRadius: '6px',
                      paddingLeft: '12px',
                      paddingRight: '4px',
                    },
                  },
                  Text: { style: { fontSize: '13px', color: '#e2e8f0' } },
                  Action: { style: { color: '#94a3b8' } },
                }}
              >
                {market.dma_name}
                <span className={css({ color: '#64748b', marginLeft: '6px', fontSize: '11px' })}>
                  ({market.station_count})
                </span>
              </Tag>
            ))}
          </div>
        )}

        {/* Market search input */}
        <div ref={dropdownRef} className={css({ position: 'relative', maxWidth: '480px' })}>
          <Input
            value={marketSearch}
            onChange={(e) => {
              setMarketSearch((e.target as HTMLInputElement).value)
              setShowDropdown(true)
            }}
            onFocus={() => setShowDropdown(true)}
            placeholder="Search markets to add (e.g., Washington, Philadelphia)..."
            size={SIZE.compact}
            overrides={{
              Root: { style: { backgroundColor: colors.bgSecondary } },
            }}
          />

          {showDropdown && marketResults.length > 0 && (
            <div
              className={css({
                position: 'absolute',
                top: '100%',
                left: 0,
                right: 0,
                zIndex: 100,
                backgroundColor: colors.bgElevated,
                border: `1px solid ${colors.border}`,
                borderRadius: '8px',
                marginTop: '4px',
                maxHeight: '240px',
                overflowY: 'auto',
                boxShadow: '0 4px 12px rgba(0,0,0,0.2)',
              })}
            >
              {marketResults.map((m) => (
                <div
                  key={m.id}
                  onClick={() => addMarket(m)}
                  className={css({
                    padding: '10px 14px',
                    cursor: 'pointer',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    fontSize: '13px',
                    color: colors.textPrimary,
                    ':hover': { backgroundColor: colors.bgSecondary },
                  })}
                >
                  <span>{m.dma_name}</span>
                  <span className={css({ color: colors.textMuted, fontSize: '12px' })}>
                    {m.station_count} stations
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Stat cards */}
      <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
        <StatCard
          label="Active Monitors"
          value={selectedMarkets.length > 0 ? String(Number(stats.active_now)) : '—'}
          color={selectedMarkets.length > 0 ? colors.primary : undefined}
        />
        <StatCard
          label="Stations"
          value={selectedMarkets.length > 0 ? String(Number(stats.stations)) : '—'}
        />
        <StatCard
          label="Spenders"
          value={selectedMarkets.length > 0 ? String(Number(stats.spenders)) : '—'}
        />
        <StatCard
          label="Total $"
          value={selectedMarkets.length > 0 && stats.total_dollars ? formatCurrency(stats.total_dollars) : '—'}
        />
      </div>

      {/* Monitors table */}
      {selectedMarkets.length === 0 ? (
        <div
          className={css({
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
            padding: '48px',
            textAlign: 'center',
          })}
        >
          <div className={css({ fontSize: '32px', marginBottom: '12px' })}>👁</div>
          <div className={css({ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, marginBottom: '8px' })}>
            Select markets above to see active monitors
          </div>
          <div className={css({ fontSize: '13px', color: colors.textMuted })}>
            Search and add DMA markets to filter the 7,699+ active monitoring windows
          </div>
        </div>
      ) : (
        <>
          {/* Search bar */}
          <div className={css({ display: 'flex', gap: '12px', marginBottom: '16px', alignItems: 'flex-end' })}>
            <div className={css({ width: '320px' })}>
              <Input
                value={searchInput}
                onChange={(e) => setSearchInput((e.target as HTMLInputElement).value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') setSearch(searchInput)
                }}
                placeholder="Search spender or station..."
                size={SIZE.compact}
                overrides={{
                  Root: { style: { backgroundColor: colors.bgElevated } },
                }}
              />
            </div>
            <Button kind={KIND.secondary} size={SIZE.compact} onClick={() => setSearch(searchInput)}>
              Search
            </Button>
            {search && (
              <Button kind={KIND.tertiary} size={SIZE.compact} onClick={() => { setSearch(''); setSearchInput('') }}>
                Clear
              </Button>
            )}
          </div>

          <DataTable
            data={monitors}
            columns={columns}
            loading={monitorsLoading}
            emptyMessage="No active monitors for selected markets"
          />

          {/* Pagination */}
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
                <span
                  className={css({
                    display: 'flex', alignItems: 'center', padding: '0 12px',
                    fontSize: '13px', color: colors.textSecondary,
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
        </>
      )}
    </div>
  )
}
