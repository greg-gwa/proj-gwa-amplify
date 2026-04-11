import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'

export const dynamic = 'force-dynamic'

// --- Bigram clustering helpers ---

function getBigrams(str: string): Set<string> {
  const s = str.toLowerCase().replace(/[^a-z0-9]/g, ' ')
  const bigrams = new Set<string>()
  for (let i = 0; i < s.length - 1; i++) bigrams.add(s.slice(i, i + 2))
  return bigrams
}

function bigramSimilarity(a: string, b: string): number {
  const setA = getBigrams(a)
  const setB = getBigrams(b)
  let intersection = 0
  for (const bg of setA) {
    if (setB.has(bg)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}

type ClipRow = Record<string, unknown> & {
  transcript: string | null
  station_or_channel: string
  air_date: string | null
  air_time: string | null
  created_at: string
}

function clusterByTranscript(clips: ClipRow[]): ClipRow[] {
  const THRESHOLD = 0.50

  type Cluster = {
    headTranscript: string
    clips: ClipRow[]
    newestAt: string
  }

  const clusters: Cluster[] = []

  for (const clip of clips) {
    const t = (clip.transcript || '').trim()
    let matched = false

    if (t.length > 0) {
      for (const cluster of clusters) {
        if (bigramSimilarity(t, cluster.headTranscript) > THRESHOLD) {
          cluster.clips.push(clip)
          if (clip.created_at > cluster.newestAt) cluster.newestAt = clip.created_at
          matched = true
          break
        }
      }
    }

    if (!matched) {
      clusters.push({ headTranscript: t, clips: [clip], newestAt: clip.created_at })
    }
  }

  // Sort clusters: most recently seen first
  clusters.sort((a, b) => (b.newestAt > a.newestAt ? 1 : b.newestAt < a.newestAt ? -1 : 0))

  // Within each cluster: alphabetical by station, then air_date, then air_time
  for (const cluster of clusters) {
    cluster.clips.sort((a, b) => {
      const stn = (a.station_or_channel || '').localeCompare(b.station_or_channel || '')
      if (stn !== 0) return stn
      const dateA = a.air_date || ''
      const dateB = b.air_date || ''
      if (dateA !== dateB) return dateA < dateB ? -1 : 1
      const timeA = a.air_time || ''
      const timeB = b.air_time || ''
      return timeA < timeB ? -1 : timeA > timeB ? 1 : 0
    })
  }

  return clusters.flatMap((c) =>
    c.clips.map((clip, i) => ({ ...clip, is_cluster_duplicate: i > 0 }))
  )
}

// --- Route handler ---

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url)
    const limit = Math.min(parseInt(searchParams.get('limit') || '50'), 200)
    const offset = parseInt(searchParams.get('offset') || '0')
    const status = searchParams.get('status')
    const station = searchParams.get('station')
    const detectionMethod = searchParams.get('detection_method')

    const conditions: string[] = []
    const params: unknown[] = []
    let idx = 1

    if (station) {
      conditions.push(`LOWER(ac.station_or_channel) LIKE LOWER($${idx})`)
      params.push(`%${station}%`)
      idx++
    }
    if (status === 'relevant') {
      conditions.push(`ac.is_relevant = true`)
    } else if (status === 'not_relevant') {
      conditions.push(`ac.is_relevant = false`)
    }
    if (detectionMethod) {
      conditions.push(`ac.detection_method = $${idx}`)
      params.push(detectionMethod)
      idx++
    }

    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : ''

    const rows = await query<ClipRow>(
      `SELECT ac.id, ac.source_url, ac.source_platform,
              ac.station_or_channel, ac.clip_duration_seconds as duration_seconds,
              ac.ad_type, ac.advertiser, ac.confidence, ac.is_relevant,
              ac.transcript as transcript,
              ac.detection_method,
              COALESCE(c.storage_path, ac.video_storage_path) as video_storage_path,
              ac.thumbnail_storage_path,
              ac.air_date::TEXT as air_date, ac.air_time,
              ac.matched_spender_name,
              ac.creative_id::TEXT as creative_id,
              ac.radar_item_id::TEXT as radar_item_id,
              COALESCE(c.airing_count, 1) as airing_count,
              c.title as creative_title,
              c.station_first_seen as creative_first_station,
              c.date_first_aired::TEXT as creative_first_aired,
              ac.created_at::TEXT as created_at
       FROM ad_clips ac
       LEFT JOIN creatives c ON c.id = ac.creative_id
       ${where}
       ORDER BY ac.created_at DESC
       LIMIT $${idx} OFFSET $${idx + 1}`,
      [...params, limit, offset]
    )

    const countResult = await query<{ total: number }>(
      `SELECT COUNT(*) as total FROM ad_clips ac ${where}`,
      params
    )

    const clustered = clusterByTranscript(rows)

    return NextResponse.json({
      data: clustered,
      total: Number(countResult[0]?.total ?? 0),
    })
  } catch (error) {
    console.error('Clips API error:', error)
    return NextResponse.json({ error: 'Failed to fetch clips' }, { status: 500 })
  }
}
