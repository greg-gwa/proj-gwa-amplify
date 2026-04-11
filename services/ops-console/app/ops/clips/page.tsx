'use client'

import React, { useEffect, useState, useCallback } from 'react'
import { useStyletron } from 'baseui'
import { Input, SIZE as INPUT_SIZE } from 'baseui/input'
import { Select, SIZE } from 'baseui/select'
import { PageHeader } from '@/components/PageHeader'
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
  transcript: string | null
  detection_method: string | null
  video_storage_path: string | null
  matched_spender_name: string | null
  creative_id: string | null
  radar_item_id: string | null
  airing_count: number | null
  creative_first_station: string | null
  creative_first_aired: string | null
  creative_title: string | null
  created_at: string
}

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
  const [detectionFilter, setDetectionFilter] = useState<Array<{ id: string }>>([])
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [deletingId, setDeletingId] = useState<string | null>(null)

  const handleDelete = async (clipId: string) => {
    if (!confirm('Delete this clip and its video from storage?')) return
    setDeletingId(clipId)
    try {
      const res = await fetch(`/api/clips/${clipId}`, { method: 'DELETE' })
      if (res.ok) {
        setClips((prev) => prev.filter((c) => c.id !== clipId))
      } else {
        const data = await res.json()
        alert(`Delete failed: ${data.error || 'Unknown error'}`)
      }
    } catch (err) {
      console.error('Delete error:', err)
      alert('Delete failed — check console')
    } finally {
      setDeletingId(null)
    }
  }

  const fetchData = useCallback(() => {
    setLoading(true)
    const params = new URLSearchParams()
    if (stationFilter) params.set('station', stationFilter)
    const detection = detectionFilter[0]?.id
    if (detection) params.set('detection_method', detection)
    params.set('limit', '100')
    fetch(`/api/clips?${params}`)
      .then((r) => r.json())
      .then((data) => setClips(data.data || []))
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [stationFilter, detectionFilter])

  useEffect(() => {
    fetchData()
  }, [fetchData])

  const detectionLabel = (method: string | null) => {
    if (method === 'cc_search') return 'CC'
    if (method === 'gap_scan') return 'Audio'
    return '—'
  }

  const detectionColor = (method: string | null) => {
    if (method === 'cc_search') return '#3b82f6'
    if (method === 'gap_scan') return '#8b5cf6'
    return colors.textMuted
  }

  /** Highlight political ad patterns in transcript text */
  const highlightTranscript = (text: string) => {
    const patterns = [
      /i(?:'m|\s+am)\s+[\w\s]+and\s+i\s+approve\s+this\s+message/gi,
      /(?:authorized\s+and\s+)?paid\s+for\s+by\s+[^.]+/gi,
    ]
    const highlights: Array<{ start: number; end: number }> = []
    for (const pat of patterns) {
      let m: RegExpExecArray | null
      while ((m = pat.exec(text)) !== null) {
        highlights.push({ start: m.index, end: m.index + m[0].length })
      }
    }
    if (highlights.length === 0) return text
    highlights.sort((a, b) => a.start - b.start)
    const merged: typeof highlights = []
    for (const h of highlights) {
      const last = merged[merged.length - 1]
      if (last && h.start <= last.end) last.end = Math.max(last.end, h.end)
      else merged.push({ ...h })
    }
    const parts: React.ReactNode[] = []
    let pos = 0
    for (const h of merged) {
      if (pos < h.start) parts.push(text.slice(pos, h.start))
      parts.push(
        <span key={h.start} style={{ backgroundColor: '#fbbf2440', color: '#d97706', fontWeight: 600, borderRadius: '2px', padding: '0 2px' }}>
          {text.slice(h.start, h.end)}
        </span>
      )
      pos = h.end
    }
    if (pos < text.length) parts.push(text.slice(pos))
    return <>{parts}</>
  }

  const truncate = (s: string, len: number) => s.length > len ? s.substring(0, len) + '…' : s

  return (
    <div>
      <PageHeader title="Clip Library" subtitle={`${clips.length} clips captured`} />

      {/* Filters */}
      <div className={css({ display: 'flex', gap: '12px', marginBottom: '24px' })}>
        <div className={css({ width: '220px' })}>
          <Input
            value={stationFilter}
            onChange={(e) => setStationFilter((e.target as HTMLInputElement).value)}
            placeholder="Search station..."
            size={INPUT_SIZE.compact}
            clearable
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

      {loading ? (
        <div className={css({ padding: '60px', textAlign: 'center', color: colors.textMuted, fontSize: '14px' })}>
          Loading clips...
        </div>
      ) : clips.length === 0 ? (
        <div className={css({ padding: '60px', textAlign: 'center', color: colors.textMuted, fontSize: '14px' })}>
          No clips found. Run a scan from the Watchlist page to capture ads.
        </div>
      ) : (
        <div
          className={css({
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(360px, 1fr))',
            gap: '20px',
          })}
        >
          {clips.map((clip) => {
            const isExpanded = expandedId === clip.id
            const transcript = clip.transcript || ''
            const title = clip.creative_title || clip.advertiser || clip.matched_spender_name || 'Unknown Spender'
            const hasVideo = !!clip.video_storage_path

            return (
              <div
                key={clip.id}
                className={css({
                  backgroundColor: colors.bgElevated,
                  borderRadius: '12px',
                  border: `1px solid ${colors.border}`,
                  overflow: 'hidden',
                  transition: 'box-shadow 0.2s, border-color 0.2s',
                  ':hover': {
                    borderColor: colors.primary,
                    boxShadow: `0 4px 20px ${colors.primary}15`,
                  },
                })}
              >
                {/* Video area */}
                {hasVideo ? (
                  <div className={css({ position: 'relative', backgroundColor: '#000' })}>
                    <video
                      controls
                      preload="metadata"
                      className={css({
                        width: '100%',
                        display: 'block',
                        maxHeight: '220px',
                        objectFit: 'contain',
                      })}
                    >
                      <source src={`/api/clips/${clip.id}/video`} type="video/mp4" />
                    </video>
                  </div>
                ) : (
                  <div
                    className={css({
                      height: '80px',
                      backgroundColor: `${detectionColor(clip.detection_method)}10`,
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderBottom: `1px solid ${colors.border}`,
                    })}
                  >
                    <span className={css({ fontSize: '12px', color: colors.textMuted, fontStyle: 'italic' })}>
                      CC transcript only — no video
                    </span>
                  </div>
                )}

                {/* Card body */}
                <div className={css({ padding: '14px 16px' })}>
                  {/* Top row: spender + badges */}
                  <div className={css({ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' })}>
                    <div className={css({ fontWeight: 700, fontSize: '14px', color: colors.textPrimary, flex: 1, marginRight: '8px' })}>
                      {title}
                    </div>
                    <div className={css({ display: 'flex', gap: '6px', flexShrink: 0 })}>
                      {clip.airing_count && clip.airing_count > 1 && (
                        <span className={css({
                          fontSize: '10px', fontWeight: 700,
                          color: '#fff', backgroundColor: colors.warning,
                          borderRadius: '10px', padding: '2px 8px',
                          whiteSpace: 'nowrap',
                        })}>
                          {clip.airing_count}x aired
                        </span>
                      )}
                      <span className={css({
                        fontSize: '10px', fontWeight: 700,
                        color: detectionColor(clip.detection_method),
                        backgroundColor: `${detectionColor(clip.detection_method)}15`,
                        borderRadius: '10px', padding: '2px 8px',
                        whiteSpace: 'nowrap',
                      })}>
                        {detectionLabel(clip.detection_method)}
                      </span>
                    </div>
                  </div>

                  {/* Meta row */}
                  <div className={css({ display: 'flex', gap: '12px', fontSize: '11px', color: colors.textMuted, marginBottom: '10px', flexWrap: 'wrap' })}>
                    <span>📺 {clip.station_or_channel}</span>
                    {clip.air_date && <span>📅 {formatDate(clip.air_date)}</span>}
                    {clip.air_time && <span>🕐 {clip.air_time}</span>}
                    {clip.confidence && <span>🎯 {formatPercent(clip.confidence)}</span>}
                  </div>

                  {/* Transcript preview */}
                  <div
                    className={css({
                      fontSize: '12px',
                      lineHeight: '1.5',
                      color: colors.textSecondary,
                      cursor: transcript.length > 120 ? 'pointer' : 'default',
                    })}
                    onClick={() => {
                      if (transcript.length > 120) setExpandedId(isExpanded ? null : clip.id)
                    }}
                  >
                    {isExpanded ? (
                      <div className={css({ fontFamily: '"Georgia", serif', fontSize: '13px', lineHeight: '1.7', color: colors.textPrimary })}>
                        {highlightTranscript(transcript)}
                      </div>
                    ) : (
                      <>
                        {truncate(transcript, 120)}
                        {transcript.length > 120 && (
                          <span className={css({ color: colors.primary, fontWeight: 500, marginLeft: '4px' })}>more</span>
                        )}
                      </>
                    )}
                  </div>

                  {/* Links row */}
                  <div className={css({ display: 'flex', gap: '12px', marginTop: '12px', flexWrap: 'wrap', borderTop: `1px solid ${colors.border}`, paddingTop: '10px', alignItems: 'center' })}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDelete(clip.id) }}
                      disabled={deletingId === clip.id}
                      className={css({
                        fontSize: '10px',
                        fontWeight: 600,
                        color: deletingId === clip.id ? colors.textMuted : '#ef4444',
                        backgroundColor: 'transparent',
                        border: '1px solid #ef444440',
                        borderRadius: '6px',
                        padding: '3px 10px',
                        cursor: deletingId === clip.id ? 'wait' : 'pointer',
                        transition: 'all 0.15s',
                        ':hover': {
                          backgroundColor: '#ef444415',
                          borderColor: '#ef4444',
                        },
                      })}
                    >
                      {deletingId === clip.id ? 'Deleting…' : '🗑 Delete'}
                    </button>
                    {clip.creative_first_aired && (
                      <span className={css({ fontSize: '10px', color: colors.textMuted })}>
                        First seen {formatDate(clip.creative_first_aired)}{clip.creative_first_station ? ` on ${clip.creative_first_station}` : ''}
                      </span>
                    )}
                    {clip.radar_item_id && (
                      <a href={`/ops/radar?highlight=${clip.radar_item_id}`}
                        className={css({ color: colors.primary, textDecoration: 'none', fontSize: '10px', fontWeight: 600, ':hover': { textDecoration: 'underline' } })}>
                        FCC Filing
                      </a>
                    )}
                    {clip.matched_buy_id && (
                      <a href={`/ops/buys/${clip.matched_buy_id}`}
                        className={css({ color: colors.primary, textDecoration: 'none', fontSize: '10px', fontWeight: 600, ':hover': { textDecoration: 'underline' } })}>
                        Matched Buy
                      </a>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
