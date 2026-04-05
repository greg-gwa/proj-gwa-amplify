'use client'

import React, { useEffect, useState } from 'react'
import { useStyletron } from 'baseui'
import { useParams, useRouter } from 'next/navigation'
import { Button, KIND, SIZE } from 'baseui/button'
import { PageHeader } from '@/components/PageHeader'
import { StatusTag } from '@/components/StatusTag'
import { colors } from '@/theme/customTheme'
import { formatCurrency, formatDate, formatPercent } from '@/lib/format'

interface BuyDetail {
  buy: {
    id: string
    estimate_number: string
    spender_name: string
    agency: string
    flight_start: string
    flight_end: string
    total_dollars: number
    extraction_confidence: number
    status: string
    market: string
    email_subject: string
    email_sender: string
    source_email_id: string
    created_at: string
  }
  lines: Array<{
    id: string
    station_name: string
    station_call_letters: string
    station_market: string
    spot_length: number
    total_spots: number
    total_spend: number
    rate: number
    weeks: Array<{
      week_start: string
      week_end: string
      spots: number
      spend: number
    }> | null
  }>
  creatives: Array<{
    id: string
    title: string
    ad_type: string
    duration: number
    status: string
    assignment_type: string
  }>
  matched_filings: Array<{
    id: string
    fcc_filing_id: string
    station_call_sign: string
    market_name: string
    spender_name: string
    total_dollars: number
    flight_start: string
    flight_end: string
    filing_url: string
    status: string
    detected_at: string
  }>
}

export default function BuyDetailPage() {
  const [css] = useStyletron()
  const params = useParams()
  const router = useRouter()
  const [data, setData] = useState<BuyDetail | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetch(`/api/buys/${params.id}`)
      .then((r) => {
        if (!r.ok) throw new Error('Not found')
        return r.json()
      })
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false))
  }, [params.id])

  if (loading) {
    return (
      <div className={css({ color: colors.textMuted, padding: '48px', textAlign: 'center' })}>
        Loading...
      </div>
    )
  }

  if (error || !data) {
    return (
      <div>
        <PageHeader title="Buy Not Found" />
        <Button kind={KIND.secondary} size={SIZE.compact} onClick={() => router.push('/ops/buys')}>
          Back to Buys
        </Button>
      </div>
    )
  }

  const { buy, lines, creatives, matched_filings = [] } = data
  const hasCreatives = creatives.length > 0
  const hasFilings = matched_filings.length > 0

  return (
    <div>
      <div className={css({ marginBottom: '16px' })}>
        <Button kind={KIND.tertiary} size={SIZE.compact} onClick={() => router.push('/ops/buys')}>
          ← Back to Buys
        </Button>
      </div>

      <PageHeader
        title={`${buy.spender_name || 'Unknown Spender'} — Est #${buy.estimate_number || 'N/A'}`}
        subtitle={`${buy.agency || 'No agency'} · ${formatDate(buy.flight_start)} – ${formatDate(buy.flight_end)}`}
        actions={<StatusTag status={buy.status} />}
      />

      {/* Summary Cards */}
      <div
        className={css({
          display: 'flex',
          gap: '16px',
          flexWrap: 'wrap',
          marginBottom: '24px',
        })}
      >
        <InfoCard label="Total" value={formatCurrency(buy.total_dollars)} />
        <InfoCard
          label="Confidence"
          value={formatPercent(buy.extraction_confidence)}
          color={buy.extraction_confidence >= 0.8 ? colors.success : buy.extraction_confidence >= 0.5 ? colors.warning : colors.error}
        />
        <InfoCard label="Stations" value={String(lines.length)} />
        <InfoCard label="Creatives" value={String(creatives.length)} color={hasCreatives ? undefined : colors.warning} />
      </div>

      {/* Source Email */}
      {buy.email_subject && (
        <div
          className={css({
            backgroundColor: colors.bgElevated,
            borderRadius: '12px',
            border: `1px solid ${colors.border}`,
            padding: '16px 20px',
            marginBottom: '24px',
          })}
        >
          <div className={css({ fontSize: '12px', fontWeight: 600, color: colors.textMuted, marginBottom: '8px', textTransform: 'uppercase', letterSpacing: '0.05em' })}>
            Source Email
          </div>
          <div className={css({ fontSize: '14px', fontWeight: 500, color: colors.textPrimary })}>
            {buy.email_subject}
          </div>
          <div className={css({ fontSize: '13px', color: colors.textMuted, marginTop: '4px' })}>
            From: {buy.email_sender}
          </div>
        </div>
      )}

      {/* Station Breakdown */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          overflow: 'hidden',
          marginBottom: '24px',
        })}
      >
        <div className={css({ padding: '16px 20px', borderBottom: `1px solid ${colors.border}` })}>
          <h3 className={css({ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, margin: 0 })}>
            Station Breakdown
          </h3>
        </div>
        {lines.length === 0 ? (
          <div className={css({ padding: '24px', color: colors.textMuted, fontSize: '13px', textAlign: 'center' })}>
            No line items
          </div>
        ) : (
          <table className={css({ width: '100%', borderCollapse: 'collapse', fontSize: '13px' })}>
            <thead>
              <tr className={css({ backgroundColor: colors.bgSecondary })}>
                {['Station', 'Market', 'Length', 'Spots', 'Rate', 'Total'].map((h) => (
                  <th
                    key={h}
                    className={css({
                      padding: '10px 16px',
                      textAlign: 'left',
                      fontSize: '12px',
                      fontWeight: 600,
                      color: colors.textMuted,
                      textTransform: 'uppercase',
                      letterSpacing: '0.05em',
                      borderBottom: `1px solid ${colors.border}`,
                    })}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {lines.map((line) => (
                <React.Fragment key={line.id}>
                  <tr className={css({ ':hover': { backgroundColor: colors.bgSecondary } })}>
                    <td className={css({ padding: '10px 16px', fontWeight: 500, borderBottom: `1px solid ${colors.border}` })}>
                      {line.station_call_letters || line.station_name}
                    </td>
                    <td className={css({ padding: '10px 16px', color: colors.textSecondary, borderBottom: `1px solid ${colors.border}` })}>
                      {line.station_market || '—'}
                    </td>
                    <td className={css({ padding: '10px 16px', borderBottom: `1px solid ${colors.border}` })}>
                      {line.spot_length ? `${line.spot_length}s` : '—'}
                    </td>
                    <td className={css({ padding: '10px 16px', borderBottom: `1px solid ${colors.border}` })}>
                      {line.total_spots ?? '—'}
                    </td>
                    <td className={css({ padding: '10px 16px', borderBottom: `1px solid ${colors.border}` })}>
                      {line.rate ? formatCurrency(line.rate) : '—'}
                    </td>
                    <td className={css({ padding: '10px 16px', fontWeight: 600, borderBottom: `1px solid ${colors.border}` })}>
                      {formatCurrency(line.total_spend)}
                    </td>
                  </tr>
                  {line.weeks && line.weeks.length > 0 && (
                    <tr>
                      <td colSpan={6} className={css({ padding: '0 16px 10px 40px', borderBottom: `1px solid ${colors.border}` })}>
                        <div className={css({ display: 'flex', gap: '12px', flexWrap: 'wrap', paddingTop: '4px' })}>
                          {line.weeks.map((w, i) => (
                            <div
                              key={i}
                              className={css({
                                fontSize: '11px',
                                color: colors.textMuted,
                                backgroundColor: colors.bgSecondary,
                                padding: '4px 8px',
                                borderRadius: '4px',
                              })}
                            >
                              {formatDate(w.week_start)}: {w.spots} spots · {formatCurrency(w.spend)}
                            </div>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )}
                </React.Fragment>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Creatives */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${hasCreatives ? colors.border : colors.warning}`,
          overflow: 'hidden',
        })}
      >
        <div
          className={css({
            padding: '16px 20px',
            borderBottom: `1px solid ${colors.border}`,
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          })}
        >
          <h3 className={css({ fontSize: '14px', fontWeight: 600, color: colors.textPrimary, margin: 0 })}>
            Matched Creatives
          </h3>
          {!hasCreatives && (
            <StatusTag status="missing_creative" />
          )}
        </div>
        {!hasCreatives ? (
          <div className={css({ padding: '24px', color: colors.warning, fontSize: '13px', textAlign: 'center' })}>
            No creatives matched to this buy
          </div>
        ) : (
          <div className={css({ padding: '12px 20px' })}>
            {creatives.map((c) => (
              <div
                key={c.id}
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '8px 0',
                  borderBottom: `1px solid ${colors.border}`,
                })}
              >
                <span className={css({ fontWeight: 500, flex: 1 })}>{c.title}</span>
                <span className={css({ color: colors.textMuted, fontSize: '12px' })}>{c.ad_type}</span>
                <span className={css({ color: colors.textMuted, fontSize: '12px' })}>{c.duration}s</span>
                <StatusTag status={c.status} />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Matched FCC Filings */}
      <div
        className={css({
          backgroundColor: colors.bgElevated,
          borderRadius: '12px',
          border: `1px solid ${colors.border}`,
          marginTop: '24px',
        })}
      >
        <h3
          className={css({
            fontSize: '14px',
            fontWeight: 600,
            color: colors.textPrimary,
            padding: '16px 20px',
            borderBottom: `1px solid ${colors.border}`,
            margin: 0,
          })}
        >
          Matched FCC Filings ({matched_filings.length})
        </h3>
        {!hasFilings ? (
          <div className={css({ padding: '24px', color: colors.textMuted, fontSize: '13px', textAlign: 'center' })}>
            No FCC filings matched to this buy
          </div>
        ) : (
          <div className={css({ padding: '12px 20px' })}>
            {matched_filings.map((f) => (
              <div
                key={f.id}
                className={css({
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                  padding: '10px 0',
                  borderBottom: `1px solid ${colors.border}`,
                })}
              >
                <span className={css({ fontWeight: 500, flex: 1 })}>{f.spender_name}</span>
                <span className={css({ color: colors.textSecondary, fontSize: '13px', width: '80px' })}>{f.station_call_sign}</span>
                <span className={css({ color: colors.textSecondary, fontSize: '13px', width: '120px' })}>{f.market_name}</span>
                <span className={css({ color: colors.textSecondary, fontSize: '13px', width: '100px' })}>{formatDate(f.detected_at)}</span>
                <span className={css({ color: colors.textSecondary, fontSize: '13px', width: '100px' })}>{f.total_dollars ? formatCurrency(f.total_dollars) : '—'}</span>
                <StatusTag status={f.status} />
                {f.filing_url && (
                  <Button kind={KIND.tertiary} size={SIZE.mini} onClick={() => window.open(f.filing_url, '_blank')}>
                    PDF
                  </Button>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function InfoCard({ label, value, color }: { label: string; value: string; color?: string }) {
  const [css] = useStyletron()
  return (
    <div
      className={css({
        backgroundColor: colors.bgElevated,
        borderRadius: '10px',
        border: `1px solid ${colors.border}`,
        padding: '14px 20px',
        minWidth: '140px',
      })}
    >
      <div className={css({ fontSize: '11px', fontWeight: 600, color: colors.textMuted, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' })}>
        {label}
      </div>
      <div className={css({ fontSize: '20px', fontWeight: 700, color: color || colors.textPrimary })}>
        {value}
      </div>
    </div>
  )
}
