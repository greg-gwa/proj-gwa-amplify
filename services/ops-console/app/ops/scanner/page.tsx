'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { Button, KIND, SIZE } from 'baseui/button'
import { PageHeader } from '@/components/PageHeader'
import { StatCard } from '@/components/StatCard'
import { colors } from '@/theme/customTheme'
import { formatDateTime } from '@/lib/format'

interface RecentScan {
  id: string
  started_at: string
  completed_at: string
  stations_scanned: number
  filings_found: number
  new_items: number
  matched_items: number
  errors: number
}

interface ScanConfig {
  scan_interval_hours: number
  lookback_hours: number
}

export default function ScannerPage() {
  const [css] = useStyletron()
  const [scans, setScans] = useState<RecentScan[]>([])
  const [config, setConfig] = useState<ScanConfig>({ scan_interval_hours: 1, lookback_hours: 6 })
  const [loading, setLoading] = useState(true)
  const [scanning, setScanning] = useState(false)
  const [scanMsg, setScanMsg] = useState<string | null>(null)

  const fetchScans = useCallback(() => {
    setLoading(true)
    Promise.all([
      fetch('/api/watchlist/scans').then(r => r.json()),
      fetch('/api/watchlist').then(r => r.json()),
    ])
      .then(([scansData, configData]) => {
        if (scansData.data) setScans(scansData.data)
        if (configData.data) {
          setConfig({
            scan_interval_hours: configData.data.scan_interval_hours ?? 1,
            lookback_hours: configData.data.lookback_hours ?? 6,
          })
        }
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => {
    fetchScans()
  }, [fetchScans])

  const triggerScan = async () => {
    setScanning(true)
    setScanMsg(null)
    try {
      const res = await fetch('/api/scanner/trigger', {
        method: 'POST',
      })
      if (res.ok) {
        setScanMsg('✓ Scan triggered — takes ~25 min to complete')
        // Refresh scan log after a few seconds to show the new row
        setTimeout(() => fetchScans(), 5000)
      } else {
        setScanMsg(`✗ Scan failed: ${res.status} ${res.statusText}`)
      }
    } catch (err) {
      setScanMsg(`✗ Error: ${err instanceof Error ? err.message : String(err)}`)
    } finally {
      setScanning(false)
    }
  }

  const lastCompletedScan = scans.find(s => s.completed_at)
  const lastScan = lastCompletedScan || scans[0]
  // Only count new items from last 24 hours of scans
  const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000)
  const totalNew = scans
    .filter(s => new Date(s.started_at) >= oneDayAgo)
    .reduce((sum, s) => sum + (s.new_items || 0), 0)

  return (
    <div>
      <PageHeader
        title="Scanner"
        subtitle="FCC filing scan log — automated hourly scraper"
        actions={
          <Button
            kind={KIND.primary}
            size={SIZE.compact}
            onClick={triggerScan}
            isLoading={scanning}
          >
            📡 Scan Now
          </Button>
        }
      />

      {scanMsg && (
        <div
          className={css({
            padding: '10px 16px',
            borderRadius: '8px',
            marginBottom: '16px',
            fontSize: '13px',
            backgroundColor: scanMsg.startsWith('✓') ? 'rgba(34,197,94,0.1)' : 'rgba(239,68,68,0.1)',
            color: scanMsg.startsWith('✓') ? colors.success : colors.error,
            border: `1px solid ${scanMsg.startsWith('✓') ? colors.success : colors.error}`,
          })}
        >
          {scanMsg}
        </div>
      )}

      {/* Stat cards */}
      <div className={css({ display: 'flex', gap: '16px', marginBottom: '24px', flexWrap: 'wrap' })}>
        <StatCard
          label="Scan Interval"
          value={`${config.scan_interval_hours}h`}
          detail="runs automatically"
        />
        <StatCard
          label="Last Scan"
          value={lastScan ? formatDateTime(lastScan.started_at) : '—'}
          detail={lastScan ? `${lastScan.stations_scanned} stations` : undefined}
        />
        <StatCard
          label="New Items (24h)"
          value={totalNew}
          color={totalNew > 0 ? colors.success : undefined}
          detail={`across ${scans.length} scans`}
        />
      </div>

      {/* Scan log */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          padding: '20px',
        })}
      >
        <div
          className={css({
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '16px',
          })}
        >
          <h3 className={css({ fontSize: '15px', fontWeight: 600, color: colors.textPrimary, margin: 0 })}>
            Recent Scans
          </h3>
          <Button kind={KIND.tertiary} size={SIZE.mini} onClick={fetchScans} isLoading={loading}>
            Refresh
          </Button>
        </div>

        {/* Table header */}
        <div
          className={css({
            display: 'grid',
            gridTemplateColumns: '180px 80px 80px 80px 80px 80px',
            gap: '8px',
            padding: '8px 12px',
            fontSize: '11px',
            fontWeight: 600,
            color: colors.textMuted,
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            borderBottom: `1px solid ${colors.border}`,
            marginBottom: '4px',
          })}
        >
          <span>Started</span>
          <span>Duration</span>
          <span>Stations</span>
          <span>Filings</span>
          <span>New</span>
          <span>Matched</span>
        </div>

        {loading ? (
          <div className={css({ padding: '20px', textAlign: 'center', color: colors.textMuted, fontSize: '13px' })}>
            Loading...
          </div>
        ) : scans.length === 0 ? (
          <div className={css({ padding: '20px', textAlign: 'center', color: colors.textMuted, fontSize: '13px' })}>
            No scans recorded yet.
          </div>
        ) : (
          <div className={css({ display: 'flex', flexDirection: 'column', gap: '2px' })}>
            {scans.map((scan) => {
              const duration = scan.completed_at && scan.started_at
                ? Math.round((new Date(scan.completed_at).getTime() - new Date(scan.started_at).getTime()) / 1000)
                : null
              return (
                <div
                  key={scan.id}
                  className={css({
                    display: 'grid',
                    gridTemplateColumns: '180px 80px 80px 80px 80px 80px',
                    gap: '8px',
                    padding: '10px 12px',
                    borderRadius: '6px',
                    fontSize: '13px',
                    backgroundColor: 'transparent',
                    ':hover': { backgroundColor: colors.bgSecondary },
                  })}
                >
                  <span className={css({ color: colors.textPrimary })}>
                    {formatDateTime(scan.started_at)}
                  </span>
                  {!scan.completed_at ? (
                    <>
                      <span className={css({ color: colors.warning || '#f59e0b', fontWeight: 500, gridColumn: 'span 5' })}>
                        ⏳ In Progress...
                      </span>
                    </>
                  ) : (
                    <>
                      <span className={css({ color: colors.textMuted })}>
                        {duration !== null ? `${duration}s` : '—'}
                      </span>
                      <span className={css({ color: colors.textSecondary })}>{scan.stations_scanned}</span>
                      <span className={css({ color: colors.textSecondary })}>{scan.filings_found}</span>
                      <span
                        className={css({
                          color: scan.new_items > 0 ? colors.success : colors.textMuted,
                          fontWeight: scan.new_items > 0 ? 600 : 400,
                        })}
                      >
                        {scan.new_items}
                      </span>
                      <span
                        className={css({
                          color: scan.matched_items > 0 ? colors.primary : colors.textMuted,
                          fontWeight: scan.matched_items > 0 ? 600 : 400,
                        })}
                      >
                        {scan.matched_items}
                      </span>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Error indicator */}
      {scans.some(s => s.errors > 0) && (
        <div
          className={css({
            marginTop: '12px',
            padding: '10px 16px',
            borderRadius: '8px',
            fontSize: '13px',
            backgroundColor: 'rgba(239,68,68,0.08)',
            color: colors.error,
            border: `1px solid rgba(239,68,68,0.2)`,
          })}
        >
          ⚠ Some scans had errors. Check ingest service logs.
        </div>
      )}
    </div>
  )
}
