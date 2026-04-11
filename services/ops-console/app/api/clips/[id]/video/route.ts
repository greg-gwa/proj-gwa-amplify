import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { GoogleAuth } from 'google-auth-library'

export const dynamic = 'force-dynamic'

const BUCKET = 'amplify-raw-emails'
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.read_only'] })

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    const rows = await query<{ video_storage_path: string }>(
      'SELECT video_storage_path FROM ad_clips WHERE id = $1',
      [id]
    )

    if (!rows[0]?.video_storage_path) {
      return NextResponse.json({ error: 'Video not found' }, { status: 404 })
    }

    // Path is "gs://amplify-raw-emails/clips/2026-04-06/uuid.mp4"
    const fullPath = rows[0].video_storage_path
    const objectPath = fullPath.replace(`gs://${BUCKET}/`, '')

    // Get an access token from ADC
    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    const token = tokenResponse.token

    // Fetch directly from GCS JSON API (no signing required)
    const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`

    const gcsResp = await fetch(gcsUrl, {
      headers: { Authorization: `Bearer ${token}` },
    })

    if (!gcsResp.ok) {
      console.error(`GCS fetch failed: ${gcsResp.status} ${gcsResp.statusText}`)
      return NextResponse.json({ error: 'Video file not found in storage' }, { status: 404 })
    }

    // Pipe the response body straight through
    return new Response(gcsResp.body, {
      headers: {
        'Content-Type': 'video/mp4',
        'Content-Length': gcsResp.headers.get('content-length') || '',
        'Cache-Control': 'private, max-age=3600',
        'Accept-Ranges': 'bytes',
      },
    })
  } catch (error) {
    console.error('Video route error:', error)
    return NextResponse.json({ error: 'Failed to get video' }, { status: 500 })
  }
}
