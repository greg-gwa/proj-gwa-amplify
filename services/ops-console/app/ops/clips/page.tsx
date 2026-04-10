'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { Input, SIZE as INPUT_SIZE } from 'baseui/input'
import { Select, SIZE } from 'baseui/select'
import { Button, KIND } from 'baseui/button'
import { PageHeader } from '@/components/PageHeader'
import { DataTable } from '@/components/DataTable'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatDate, formatPercent } from '@/lib/format'

interface Clip {
  id: string
  air_date: string | null
  air_time: string | null
  station_or_channel: string
  duration_seconds: number
  ad_type: string
  advertiser: string
  matched_buy_id: string | null
  confidence: number
  status: string
  transcript_excerpt: string
  detection_method: string | null
  video_storage_path: string | null
  matched_spender_name: string | null
  created_at: string
}

const statusOptions = [
  { id: '', label: 'All Statuses' },
  { id: 'new', label: 'New' },
  { id: 'matched', label: 'Matched' },
  { id: 'unmatched', label: 'Unmatched' },
  { id: 'review', label: 'Review' },
  { id: 'dismissed', label: 'Dismissed' },
]

const detectionOptions = [
  { id: '', label: 'All Sources' },
  { id: 'cc_search', label: 'CC Search' },
  { id: 'gap_scan', label: 'Gap Scan' },
]

export default function ClipsPage() {
  const [css] = useStyletron()
  const [clips, setClips] = useState<Clip[]>([])
  const [loading, setLoading] = useState(true)
  const [stationFilter, setStationFilter] = useState('')
  const [statusFilter, setStatusFilter] = useState<Array<{ id: string }>>([])
  const [detectionFilter, setDetectionFilter] = useState<Array<{ id: string }>>([])
  const [uploadUrl, setUploadUrl] = useState('')

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (stationFilter) params.set('station', stationFilter)
    const status = statusFilter[0]?.id
    if (status) params.set('status', status)
    const detection = detectionFilter[0]?.id
    if (detection) params.set('detection_method', detection)
    fetch(`/api/clips?${params}`)
      .then((r) => r.json())
      .then((data) => setClips(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [stationFilter, statusFilter, detectionFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const detectionLabel = (method: string | null) => {
    if (method === 'cc_search') return 'CC Search'
    if (method === 'gap_scan') return 'Gap Scan'
    return null
  }

  const detectionColor = (method: string | null) => {
    if (method === 'cc_search') return '#3b82f6'
    if (method === 'gap_scan') return '#8b5cf6'
    return colors.textMuted
  }

  const columns = [
    {
      header: 'Date',
      id: 'date',
      render: (row: Clip) => (
        <span className={css({ fontSize: '12px', color: colors.textSecondary })}>
          {row.air_date ? formatDate(row.air_date) : '—'}
          {row.air_time ? (
            <span className={css({ display: 'block', fontSize: '11px', color: colors.textMuted })}>{row.air_time}</span>
          ) : null}
        </span>
      ),
      width: '100px',
    },
    {
      header: 'Station',
      id: 'station',
      render: (row: Clip) => (
        <span className={css({ fontWeight: 500 })}>{row.station_or_channel || '—'}</span>
      ),
      width: '100px',
    },
    {
      header: 'Detection',
      id: 'detection',
      render: (row: Clip) => {
        const label = detectionLabel(row.detection_method)
        if (!label) return <span className={css({ color: colors.textMuted, fontSize: '12px' })}>—</span>
        return (
          <span
            className={css({
              fontSize: '11px',
              fontWeight: 600,
              color: detectionColor(row.detection_method),
              backgroundColor: `${detectionColor(row.detection_method)}20`,
              borderRadius: '4px',
              padding: '2px 6px',
              whiteSpace: 'nowrap',
            })}
          >
            {label}
          </span>
        )
      },
      width: '100px',
    },
    {
      header: 'Duration',
      id: 'duration',
      render: (row: Clip) => (row.duration_seconds ? `${row.duration_seconds}s` : '—'),
      width: '70px',
    },
    {
      header: 'Type',
      id: 'type',
      render: (row: Clip) => row.ad_type || '—',
      width: '80px',
    },
    {
      header: 'Advertiser',
      id: 'advertiser',
      render: (row: Clip) => (
        <span className={css({ fontWeight: 500 })}>
          {row.advertiser || row.matched_spender_name || '—'}
        </span>
      ),
    },
    {
      header: 'Transcript',
      id: 'transcript',
      render: (row: Clip) => (
        <span className={css({ color: colors.textMuted, fontSize: '12px' })}>
          {row.transcript_excerpt
            ? row.transcript_excerpt.substring(0, 80) + (row.transcript_excerpt.length > 80 ? '...' : '')
            : '—'}
        </span>
      ),
    },
    {
      header: 'Video',
      id: 'video',
      render: (row: Clip) =>
        row.video_storage_path ? (
          <a
            href={`/api/clips/${row.id}/video`}
            target="_blank"
            rel="noopener noreferrer"
            className={css({
              color: colors.primary,
              textDecoration: 'none',
              fontSize: '12px',
              fontWeight: 500,
              ':hover': { textDecoration: 'underline' },
            })}
          >
            Watch
          </a>
        ) : (
          <span className={css({ color: colors.textMuted, fontSize: '12px' })}>—</span>
        ),
      width: '60px',
    },
    {
      header: 'Buy',
      id: 'buy',
      render: (row: Clip) =>
        row.matched_buy_id ? (
          <a
            href={`/ops/buys/${row.matched_buy_id}`}
            className={css({ color: colors.primary, textDecoration: 'none', fontSize: '12px', ':hover': { textDecoration: 'underline' } })}
          >
            View Buy
          </a>
        ) : (
          <span className={css({ color: colors.textMuted, fontSize: '12px' })}>—</span>
        ),
      width: '80px',
    },
    {
      header: 'Conf.',
      id: 'confidence',
      render: (row: Clip) => {
        if (!row.confidence) return '—'
        const color = row.confidence >= 0.8 ? colors.success : row.confidence >= 0.5 ? colors.warning : colors.error
        return <span className={css({ color, fontWeight: 600 })}>{formatPercent(row.confidence)}</span>
      },
      width: '70px',
    },
    {
      header: 'Status',
      id: 'status',
      render: (row: Clip) => <StatusTag status={row.status} />,
      width: '100px',
    },
  ]

  return (
    <div>
      <PageHeader title="Clips" subtitle="Transcribed ad clips" />

      {/* Upload Section */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          padding: '16px 20px',
          marginBottom: '20px',
          display: 'flex',
          gap: '12px',
          alignItems: 'flex-end',
        })}
      >
        <div className={css({ flex: 1 })}>
          <div className={css({ fontSize: '12px', fontWeight: 600, color: colors.textMuted, marginBottom: '6px', textTransform: 'uppercase', letterSpacing: '0.05em' })}>
            Submit Clip URL
          </div>
          <Input
            value={uploadUrl}
            onChange={(e) => setUploadUrl((e.target as HTMLInputElement).value)}
            placeholder="https://..."
            size={INPUT_SIZE.compact}
          />
        </div>
        <Button kind={KIND.primary} size={INPUT_SIZE.compact} disabled={!uploadUrl}>
          Submit
        </Button>
      </div>

      {/* Filters */}
      <div className={css({ display: 'flex', gap: '12px', marginBottom: '16px' })}>
        <div className={css({ width: '200px' })}>
          <Input
            value={stationFilter}
            onChange={(e) => setStationFilter((e.target as HTMLInputElement).value)}
            placeholder="Search station..."
            size={INPUT_SIZE.compact}
            clearable
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
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
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
          />
        </div>
        <div className={css({ width: '180px' })}>
          <Select
            options={detectionOptions}
            value={detectionFilter}
            placeholder="Detection source"
            onChange={({ value }) => setDetectionFilter(value as Array<{ id: string }>)}
            clearable
            size={SIZE.compact}
            overrides={{ Root: { style: { backgroundColor: colors.bgElevated } } }}
          />
        </div>
      </div>

      <DataTable data={clips} columns={columns} loading={loading} emptyMessage="No clips found" />
    </div>
  )
}
