'use client'

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useStyletron } from 'baseui'
import { Button, KIND, SIZE } from 'baseui/button'
import { ButtonGroup } from 'baseui/button-group'
import { Input } from 'baseui/input'
import { Tag } from 'baseui/tag'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatCard } from '@/components/StatCard'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate } from '@/lib/format'

interface CmScan {
  id: string
  status: string
  total_monitors: number
  scanned_monitors: number
  total_days: number
  scanned_days: number
  clips_found: number
  clips_matched: number
  clips_orphaned: number
  cm_requests_used: number
  error_details: string | null
  started_at: string | null
  completed_at: string | null
}

interface Budget {
  total: number
  used: number
  remaining: number
  pct_used: number
}

type Mode = 'region' | 'spender' | 'candidate'

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

interface SpenderOption {
  id: string
  name: string
  type: string | null
  party: string | null
  total_buys: number
  total_dollars: number
}

interface CandidateOption {
  cand_id: string
  cand_name: string
  party: string | null
  office: string | null
  state: string | null
  district: string | null
  total_spenders: number
  total_dollars: number
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

const MODE_LABELS: Record<Mode, string> = {
  region: 'Region',
  spender: 'Spender',
  candidate: 'Candidate',
}

const MODE_SUBTITLES: Record<Mode, string> = {
  region: 'Region-based monitoring dashboard — pick markets, see active monitors',
  spender: 'Spender-based monitoring — pick spenders, see their active monitors',
  candidate: 'Candidate-based monitoring — pick candidates, see associated monitors',
}

export default function WatchlistPage() {
  const [css] = useStyletron()
  const [mode, setMode] = useState<Mode>('region')

  // Region state
  const [selectedMarkets, setSelectedMarkets] = useState<SelectedMarket[]>([])
  const [marketSearch, setMarketSearch] = useState('')
  const [marketResults, setMarketResults] = useState<MarketOption[]>([])

  // Spender state
  const [selectedSpenders, setSelectedSpenders] = useState<SpenderOption[]>([])
  const [spenderSearch, setSpenderSearch] = useState('')
  const [spenderResults, setSpenderResults] = useState<SpenderOption[]>([])

  // Candidate state
  const [selectedCandidates, setSelectedCandidates] = useState<CandidateOption[]>([])
  const [candidateSearch, setCandidateSearch] = useState('')
  const [candidateResults, setCandidateResults] = useState<CandidateOption[]>([])

  // Common state
  const [loading, setLoading] = useState(true)
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

  // CM scan state
  const [scanning, setScanning] = useState(false)
  const [scan, setScan] = useState<CmScan | null>(null)
  const [budget, setBudget] = useState<Budget | null>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // ------------------------------------------------------------------
  // CM Scan helpers
  // ------------------------------------------------------------------

  const fetchBudget = useCallback(() => {
    fetch('/api/watchlist/scan/budget')
      .then(r => r.json())
      .then(d => { if (d.data) setBudget(d.data) })
      .catch(console.error)
  }, [])

  const fetchLatestScan = useCallback(() => {
    fetch('/api/watchlist/scan')
      .then(r => r.json())
      .then(d => {
        if (d.data) {
          setScan(d.data)
          if (d.data.status === 'running' || d.data.status === 'queued') {
            setScanning(true)
          }
        }
      })
      .catch(console.error)
  }, [])

  const pollScanStatus = useCallback((scanId: string) => {
    if (pollRef.current) clearInterval(pollRef.current)
    pollRef.current = setInterval(() => {
      fetch(`/api/watchlist/scan/status?scan_id=${scanId}`)
        .then(r => r.json())
        .then(d => {
          if (d.data) {
            setScan(d.data)
            if (d.data.status === 'complete' || d.data.status === 'error') {
              setScanning(false)
              if (pollRef.current) clearInterval(pollRef.current)
              fetchBudget()
            }
          }
        })
        .catch(console.error)
    }, 3000)
  }, [fetchBudget])

  const triggerScan = useCallback(async () => {
    setScanning(true)
    try {
      const resp = await fetch('/api/watchlist/scan', { method: 'POST' })
      const data = await resp.json()
      if (!resp.ok || !data.scan_id) {
        alert(`Scan failed: ${data.error || 'Unknown error'}`)
        setScanning(false)
        return
      }
      // Seed initial scan state
      setScan({
        id: data.scan_id,
        status: 'queued',
        total_monitors: 0, scanned_monitors: 0,
        total_days: 0, scanned_days: 0,
        clips_found: 0, clips_matched: 0, clips_orphaned: 0,
        cm_requests_used: 0, error_details: null,
        started_at: null, completed_at: null,
      })
      pollScanStatus(data.scan_id)
    } catch (err) {
      console.error(err)
      setScanning(false)
    }
  }, [pollScanStatus])

  // On mount: load latest scan + budget
  useEffect(() => {
    fetchLatestScan()
    fetchBudget()
    return () => { if (pollRef.current) clearInterval(pollRef.current) }
  }, [fetchLatestScan, fetchBudget])

  // If an in-progress scan exists on load, resume polling
  useEffect(() => {
    if (scan && (scan.status === 'running' || scan.status === 'queued')) {
      pollScanStatus(scan.id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []) // intentionally run once after first scan load

  // ------------------------------------------------------------------
  // Load initial watchlist config (market IDs) for region mode
  // ------------------------------------------------------------------
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

  // Fetch monitors — adapts query based on mode
  const fetchMonitors = useCallback((p: number, q?: string, sort?: string, dir?: string) => {
    const params = new URLSearchParams()
    params.set('active', 'true')
    params.set('page', String(p))
    params.set('limit', '15')
    if (q) params.set('search', q)
    if (sort) params.set('sort', sort)
    if (dir) params.set('dir', dir)

    if (mode === 'region') {
      const ids = selectedMarkets.map(m => m.id)
      if (ids.length === 0) {
        setMonitors([])
        setStats({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
        setPagination({ page: 1, limit: 15, total: 0, totalPages: 0 })
        return
      }
      params.set('market_ids', ids.join(','))
    } else if (mode === 'spender') {
      const ids = selectedSpenders.map(s => s.id)
      if (ids.length === 0) {
        setMonitors([])
        setStats({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
        setPagination({ page: 1, limit: 15, total: 0, totalPages: 0 })
        return
      }
      params.set('spender_ids', ids.join(','))
    } else if (mode === 'candidate') {
      if (selectedCandidates.length === 0) {
        setMonitors([])
        setStats({ total_windows: 0, stations: 0, spenders: 0, active_now: 0 })
        setPagination({ page: 1, limit: 15, total: 0, totalPages: 0 })
        return
      }
      // Use first selected candidate (single-select for now)
      params.set('candidate_id', selectedCandidates[0].cand_id)
    }

    setMonitorsLoading(true)
    fetch(`/api/monitors?${params}`)
      .then(r => r.json())
      .then(data => {
        setMonitors(data.data || [])
        if (data.stats) setStats(data.stats)
        if (data.pagination) setPagination(data.pagination)
      })
      .catch(console.error)
      .finally(() => setMonitorsLoading(false))
  }, [mode, selectedMarkets, selectedSpenders, selectedCandidates])

  useEffect(() => {
    fetchMonitors(1, search || undefined, sortBy, sortDir)
    setPage(1)
  }, [fetchMonitors, search, sortBy, sortDir])

  // --- Autocomplete searches ---

  // Market search
  useEffect(() => {
    if (mode !== 'region' || !marketSearch || marketSearch.length < 2) {
      setMarketResults([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/markets?search=${encodeURIComponent(marketSearch)}`)
        .then(r => r.json())
        .then(data => {
          if (data.data) {
            const selectedIds = selectedMarkets.map(m => m.id)
            setMarketResults(data.data.filter((m: MarketOption) => !selectedIds.includes(m.id)))
          }
        })
        .catch(console.error)
    }, 200)
    return () => clearTimeout(timer)
  }, [marketSearch, selectedMarkets, mode])

  // Spender search
  useEffect(() => {
    if (mode !== 'spender' || !spenderSearch || spenderSearch.length < 2) {
      setSpenderResults([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/spenders/search?q=${encodeURIComponent(spenderSearch)}`)
        .then(r => r.json())
        .then(data => {
          if (data.data) {
            const selectedIds = selectedSpenders.map(s => s.id)
            setSpenderResults(data.data.filter((s: SpenderOption) => !selectedIds.includes(s.id)))
          }
        })
        .catch(console.error)
    }, 200)
    return () => clearTimeout(timer)
  }, [spenderSearch, selectedSpenders, mode])

  // Candidate search
  useEffect(() => {
    if (mode !== 'candidate' || !candidateSearch || candidateSearch.length < 2) {
      setCandidateResults([])
      return
    }
    const timer = setTimeout(() => {
      fetch(`/api/candidates/search?q=${encodeURIComponent(candidateSearch)}`)
        .then(r => r.json())
        .then(data => {
          if (data.data) {
            const selectedIds = selectedCandidates.map(c => c.cand_id)
            setCandidateResults(data.data.filter((c: CandidateOption) => !selectedIds.includes(c.cand_id)))
          }
        })
        .catch(console.error)
    }, 200)
    return () => clearTimeout(timer)
  }, [candidateSearch, selectedCandidates, mode])

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

  // --- Add/remove handlers ---

  const addMarket = async (market: MarketOption) => {
    setSelectedMarkets(prev => [...prev, { id: market.id, dma_name: market.dma_name, station_count: market.station_count }])
    setMarketSearch('')
    setShowDropdown(false)
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

  const addSpender = (spender: SpenderOption) => {
    setSelectedSpenders(prev => [...prev, spender])
    setSpenderSearch('')
    setShowDropdown(false)
  }

  const removeSpender = (spenderId: string) => {
    setSelectedSpenders(prev => prev.filter(s => s.id !== spenderId))
  }

  const addCandidate = (candidate: CandidateOption) => {
    setSelectedCandidates(prev => [...prev, candidate])
    setCandidateSearch('')
    setShowDropdown(false)
  }

  const removeCandidate = (candId: string) => {
    setSelectedCandidates(prev => prev.filter(c => c.cand_id !== candId))
  }

  // --- Sort/page ---

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
    if (sortBy !== columnId) return ' \u2195'
    return sortDir === 'asc' ? ' \u2191' : ' \u2193'
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
    fetchMonitors(newPage, search || undefined, sortBy, sortDir)
  }

  // --- Helpers ---

  const hasSelection = () => {
    if (mode === 'region') return selectedMarkets.length > 0
    if (mode === 'spender') return selectedSpenders.length > 0
    if (mode === 'candidate') return selectedCandidates.length > 0
    return false
  }

  const partyColor = (party: string | null) => {
    if (!party) return colors.textMuted
    const p = party.toUpperCase()
    if (p.startsWith('DEM') || p === 'DEMOCRAT') return '#2563eb'
    if (p.startsWith('REP') || p === 'REPUBLICAN') return '#dc2626'
    return colors.textSecondary
  }

  // --- Columns ---

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
          {row.market_name || '\u2014'}
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
          {row.daypart || '\u2014'}
        </span>
      ),
    },
    {
      header: 'Time Window',
      id: 'window',
      width: '110px',
      render: (row: Monitor) => (
        <span className={css({ color: colors.textSecondary })}>
          {row.time_start && row.time_end ? `${row.time_start}\u2013${row.time_end}` : '\u2014'}
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
          'MTWTF': 'Mon\u2013Fri',
          'MTWTFSS': 'Daily',
          'SS': 'Weekends',
          'S': 'Sat',
          'Su': 'Sun',
        }
        return (
          <span className={css({ color: colors.textSecondary, fontSize: '12px' })}>
            {labels[d] || d || '\u2014'}
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
            ? `${formatDate(row.flight_start)} \u2013 ${formatDate(row.flight_end)}`
            : '\u2014'}
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

  // --- Render picker section based on mode ---

  const renderPicker = () => {
    if (mode === 'region') {
      return (
        <>
          <h3 className={css({ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 12px' })}>
            Select Markets
          </h3>

          {selectedMarkets.length > 0 && (
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' })}>
              {selectedMarkets.map((market) => (
                <Tag
                  key={market.id}
                  onActionClick={() => removeMarket(market.id)}
                  closeable
                  overrides={{
                    Root: { style: { backgroundColor: '#1a365d', borderRadius: '6px', paddingLeft: '12px', paddingRight: '4px' } },
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
              overrides={{ Root: { style: { backgroundColor: colors.bgSecondary } } }}
            />
            {showDropdown && marketResults.length > 0 && renderDropdown(
              marketResults.map(m => ({
                key: m.id,
                label: m.dma_name,
                detail: `${m.station_count} stations`,
                onSelect: () => addMarket(m),
              }))
            )}
          </div>
        </>
      )
    }

    if (mode === 'spender') {
      return (
        <>
          <h3 className={css({ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 12px' })}>
            Select Spenders
          </h3>

          {selectedSpenders.length > 0 && (
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' })}>
              {selectedSpenders.map((sp) => (
                <Tag
                  key={sp.id}
                  onActionClick={() => removeSpender(sp.id)}
                  closeable
                  overrides={{
                    Root: { style: { backgroundColor: '#1a365d', borderRadius: '6px', paddingLeft: '12px', paddingRight: '4px' } },
                    Text: { style: { fontSize: '13px', color: '#e2e8f0' } },
                    Action: { style: { color: '#94a3b8' } },
                  }}
                >
                  {sp.name}
                  {sp.party && (
                    <span className={css({ color: partyColor(sp.party), marginLeft: '6px', fontSize: '11px', fontWeight: 600 })}>
                      ({sp.party})
                    </span>
                  )}
                </Tag>
              ))}
            </div>
          )}

          <div ref={dropdownRef} className={css({ position: 'relative', maxWidth: '480px' })}>
            <Input
              value={spenderSearch}
              onChange={(e) => {
                setSpenderSearch((e.target as HTMLInputElement).value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search spenders (e.g., Harris Victory Fund, NRSC)..."
              size={SIZE.compact}
              overrides={{ Root: { style: { backgroundColor: colors.bgSecondary } } }}
            />
            {showDropdown && spenderResults.length > 0 && renderDropdown(
              spenderResults.map(s => ({
                key: s.id,
                label: s.name,
                detail: `${s.total_buys} buys \u00B7 ${formatCurrency(s.total_dollars)}`,
                onSelect: () => addSpender(s),
              }))
            )}
          </div>
        </>
      )
    }

    if (mode === 'candidate') {
      return (
        <>
          <h3 className={css({ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: '0 0 12px' })}>
            Select Candidates
          </h3>

          {selectedCandidates.length > 0 && (
            <div className={css({ display: 'flex', flexWrap: 'wrap', gap: '8px', marginBottom: '12px' })}>
              {selectedCandidates.map((cand) => (
                <Tag
                  key={cand.cand_id}
                  onActionClick={() => removeCandidate(cand.cand_id)}
                  closeable
                  overrides={{
                    Root: { style: { backgroundColor: '#1a365d', borderRadius: '6px', paddingLeft: '12px', paddingRight: '4px' } },
                    Text: { style: { fontSize: '13px', color: '#e2e8f0' } },
                    Action: { style: { color: '#94a3b8' } },
                  }}
                >
                  {cand.cand_name}
                  {cand.party && (
                    <span className={css({ color: partyColor(cand.party), marginLeft: '6px', fontSize: '11px', fontWeight: 600 })}>
                      ({cand.party})
                    </span>
                  )}
                  {cand.office && (
                    <span className={css({ color: '#64748b', marginLeft: '6px', fontSize: '11px' })}>
                      {cand.office}{cand.state ? ` \u2013 ${cand.state}` : ''}{cand.district ? `-${cand.district}` : ''}
                    </span>
                  )}
                </Tag>
              ))}
            </div>
          )}

          <div ref={dropdownRef} className={css({ position: 'relative', maxWidth: '480px' })}>
            <Input
              value={candidateSearch}
              onChange={(e) => {
                setCandidateSearch((e.target as HTMLInputElement).value)
                setShowDropdown(true)
              }}
              onFocus={() => setShowDropdown(true)}
              placeholder="Search candidates (e.g., Harris, Hogan, Kaine)..."
              size={SIZE.compact}
              overrides={{ Root: { style: { backgroundColor: colors.bgSecondary } } }}
            />
            {showDropdown && candidateResults.length > 0 && renderDropdown(
              candidateResults.map(c => ({
                key: c.cand_id,
                label: c.cand_name,
                detail: [c.party, c.office, c.state, c.district].filter(Boolean).join(' \u00B7 '),
                onSelect: () => addCandidate(c),
              }))
            )}
          </div>
        </>
      )
    }

    return null
  }

  // Shared dropdown renderer
  const renderDropdown = (items: { key: string; label: string; detail: string; onSelect: () => void }[]) => (
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
      {items.map((item) => (
        <div
          key={item.key}
          onClick={item.onSelect}
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
          <span>{item.label}</span>
          <span className={css({ color: colors.textMuted, fontSize: '12px' })}>
            {item.detail}
          </span>
        </div>
      ))}
    </div>
  )

  // --- Stat cards based on mode ---

  const renderStats = () => {
    if (!hasSelection()) return null

    if (mode === 'spender') {
      // Aggregate from selected spenders
      const totalSpend = selectedSpenders.reduce((acc, s) => acc + (Number(s.total_dollars) || 0), 0)
      const totalBuys = selectedSpenders.reduce((acc, s) => acc + (Number(s.total_buys) || 0), 0)
      return (
        <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
          <StatCard label="Active Monitors" value={String(Number(stats.active_now))} color={colors.primary} />
          <StatCard label="Stations" value={String(Number(stats.stations))} />
          <StatCard label="Total Buys" value={String(totalBuys)} />
          <StatCard label="Total Spend" value={totalSpend > 0 ? formatCurrency(totalSpend) : '\u2014'} />
        </div>
      )
    }

    if (mode === 'candidate') {
      const cand = selectedCandidates[0]
      return (
        <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
          <StatCard label="Active Monitors" value={String(Number(stats.active_now))} color={colors.primary} />
          <StatCard label="Stations" value={String(Number(stats.stations))} />
          <StatCard label="Linked Spenders" value={cand ? String(Number(cand.total_spenders)) : '\u2014'} />
          <StatCard label="Total Spend" value={cand && Number(cand.total_dollars) > 0 ? formatCurrency(Number(cand.total_dollars)) : '\u2014'} />
        </div>
      )
    }

    // Region mode (default)
    return (
      <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
        <StatCard
          label="Active Monitors"
          value={String(Number(stats.active_now))}
          color={colors.primary}
        />
        <StatCard label="Stations" value={String(Number(stats.stations))} />
        <StatCard label="Spenders" value={String(Number(stats.spenders))} />
        <StatCard
          label="Total $"
          value={stats.total_dollars ? formatCurrency(stats.total_dollars) : '\u2014'}
        />
      </div>
    )
  }

  const emptyMessage = () => {
    if (mode === 'region') return 'Select markets above to see active monitors'
    if (mode === 'spender') return 'Select spenders above to see their active monitors'
    if (mode === 'candidate') return 'Select a candidate above to see associated monitors'
    return 'No selection'
  }

  if (loading) {
    return (
      <div>
        <PageHeader title="Watchlist" subtitle="Monitoring dashboard" />
        <p className={css({ color: colors.textMuted })}>Loading...</p>
      </div>
    )
  }

  // ------------------------------------------------------------------
  // Scan progress panel
  // ------------------------------------------------------------------

  const renderScanPanel = () => {
    if (!scan) return null

    const isRunning = scan.status === 'running' || scan.status === 'queued'
    const isComplete = scan.status === 'complete'
    const isError = scan.status === 'error'

    const daysPct = scan.total_days > 0
      ? Math.round((scan.scanned_days / scan.total_days) * 100)
      : 0

    const statusText = () => {
      if (scan.status === 'queued') return 'Queued — waiting for ingest service…'
      if (isRunning) {
        const station = 'scanning…'
        return `Scanning ${station} (${scan.scanned_monitors}/${scan.total_monitors} monitors, ${scan.scanned_days}/${scan.total_days} days)`
      }
      if (isComplete) {
        return `Scan complete. Found ${scan.clips_found} clips (${scan.clips_matched} matched, ${scan.clips_orphaned} orphaned).`
      }
      if (isError) return `Scan error: ${scan.error_details || 'unknown'}`
      return scan.status
    }

    const panelBorder = isError ? colors.error : isComplete ? colors.success : colors.primary

    return (
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${panelBorder}`,
          padding: '16px 20px',
          marginBottom: '20px',
        })}
      >
        <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '10px' })}>
          <div>
            <div className={css({ fontSize: '13px', fontWeight: 600, color: colors.textPrimary, marginBottom: '4px' })}>
              {isRunning ? 'Scanning for Ads…' : isComplete ? 'Scan Complete' : 'Scan Status'}
            </div>
            <div className={css({ fontSize: '12px', color: colors.textSecondary })}>
              {statusText()}
            </div>
          </div>
          {budget && (
            <div className={css({ textAlign: 'right', fontSize: '12px' })}>
              <div className={css({ color: colors.textMuted })}>CM Budget</div>
              <div className={css({ fontWeight: 600, color: budget.remaining < 100 ? colors.error : colors.textPrimary })}>
                {budget.remaining.toLocaleString()} / {budget.total.toLocaleString()} remaining
              </div>
            </div>
          )}
        </div>

        {/* Progress bar */}
        {(isRunning || isComplete) && scan.total_days > 0 && (
          <div className={css({ marginBottom: '10px' })}>
            <div className={css({ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: colors.textMuted, marginBottom: '4px' })}>
              <span>{scan.scanned_days} / {scan.total_days} days scanned</span>
              <span>{daysPct}%</span>
            </div>
            <div className={css({ height: '6px', backgroundColor: colors.bgSecondary, borderRadius: '3px', overflow: 'hidden' })}>
              <div
                className={css({
                  height: '100%',
                  width: `${daysPct}%`,
                  backgroundColor: isComplete ? colors.success : colors.primary,
                  borderRadius: '3px',
                  transition: 'width 0.4s ease',
                })}
              />
            </div>
          </div>
        )}

        {/* Stats row */}
        <div className={css({ display: 'flex', gap: '20px', fontSize: '12px', color: colors.textSecondary })}>
          <span>Monitors: <strong className={css({ color: colors.textPrimary })}>{scan.scanned_monitors}/{scan.total_monitors}</strong></span>
          <span>Clips found: <strong className={css({ color: scan.clips_found > 0 ? colors.success : colors.textPrimary })}>{scan.clips_found}</strong></span>
          {isComplete && (
            <>
              <span>Matched: <strong className={css({ color: colors.success })}>{scan.clips_matched}</strong></span>
              <span>Orphaned: <strong className={css({ color: colors.warning })}>{scan.clips_orphaned}</strong></span>
              <a
                href="/ops/clips"
                className={css({ color: colors.primary, fontWeight: 600, textDecoration: 'none', ':hover': { textDecoration: 'underline' } })}
              >
                View Clips →
              </a>
            </>
          )}
          {scan.cm_requests_used > 0 && (
            <span className={css({ marginLeft: 'auto' })}>CM requests used this scan: <strong>{scan.cm_requests_used}</strong></span>
          )}
        </div>
      </div>
    )
  }

  return (
    <div>
      <PageHeader title="Watchlist" subtitle={MODE_SUBTITLES[mode]} />

      {/* Top action bar: scan button + budget */}
      <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' })}>
        <div className={css({ display: 'flex', gap: '8px', alignItems: 'center' })}>
          <Button
            kind={KIND.primary}
            size={SIZE.compact}
            disabled={scanning}
            onClick={triggerScan}
            overrides={{
              BaseButton: {
                style: {
                  paddingLeft: '16px',
                  paddingRight: '16px',
                  fontSize: '13px',
                },
              },
            }}
          >
            {scanning ? 'Scanning…' : 'Scan for Ads'}
          </Button>
          {!scan && budget && (
            <span className={css({ fontSize: '12px', color: colors.textMuted })}>
              CM budget: {budget.remaining.toLocaleString()} requests remaining
            </span>
          )}
        </div>
      </div>

      {/* Scan progress panel */}
      {renderScanPanel()}

      {/* Mode Toggle */}
      <div className={css({ marginBottom: '20px' })}>
        <ButtonGroup
          selected={mode === 'region' ? 0 : mode === 'spender' ? 1 : 2}
          onClick={(_event, index) => {
            const modes: Mode[] = ['region', 'spender', 'candidate']
            setMode(modes[index])
            setSearch('')
            setSearchInput('')
            setPage(1)
          }}
          size={SIZE.compact}
          overrides={{
            Root: {
              style: {
                borderRadius: '8px',
                overflow: 'hidden',
              },
            },
          }}
        >
          {(['region', 'spender', 'candidate'] as Mode[]).map((m) => (
            <Button
              key={m}
              kind={mode === m ? KIND.primary : KIND.secondary}
              overrides={{
                BaseButton: {
                  style: {
                    paddingLeft: '20px',
                    paddingRight: '20px',
                    fontSize: '13px',
                    fontWeight: mode === m ? 600 : 400,
                  },
                },
              }}
            >
              {MODE_LABELS[m]}
            </Button>
          ))}
        </ButtonGroup>
      </div>

      {/* Picker Section */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          padding: '20px',
          marginBottom: '20px',
        })}
      >
        {renderPicker()}
      </div>

      {/* Stat cards */}
      {renderStats()}

      {/* Monitors table */}
      {!hasSelection() ? (
        <div
          className={css({
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
            padding: '48px',
            textAlign: 'center',
          })}
        >
          <div className={css({ fontSize: '32px', marginBottom: '12px' })}>
            {mode === 'region' ? '\uD83D\uDC41' : mode === 'spender' ? '\u25C9' : '\uD83C\uDFDB'}
          </div>
          <div className={css({ fontSize: '16px', fontWeight: 600, color: colors.textPrimary, marginBottom: '8px' })}>
            {emptyMessage()}
          </div>
          <div className={css({ fontSize: '13px', color: colors.textMuted })}>
            {mode === 'region' && 'Search and add DMA markets to filter the 7,699+ active monitoring windows'}
            {mode === 'spender' && 'Search for spenders by name to view their active monitoring windows'}
            {mode === 'candidate' && 'Search for candidates to view monitors for all their linked committees'}
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
                overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
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
            emptyMessage="No active monitors for current selection"
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
                Showing {((page - 1) * pagination.limit) + 1}\u2013{Math.min(page * pagination.limit, pagination.total)} of {pagination.total.toLocaleString()}
              </span>
              <div className={css({ display: 'flex', gap: '4px' })}>
                <Button
                  kind={KIND.secondary}
                  size={SIZE.compact}
                  disabled={page <= 1}
                  onClick={() => handlePageChange(page - 1)}
                >
                  \u2190 Prev
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
                  Next \u2192
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}
