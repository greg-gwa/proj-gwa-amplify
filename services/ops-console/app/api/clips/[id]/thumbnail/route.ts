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

    const rows = await query<{ thumbnail_storage_path: string }>(
      'SELECT thumbnail_storage_path FROM ad_clips WHERE id = $1',
      [id]
    )

    if (!rows[0]?.thumbnail_storage_path) {
      return NextResponse.json({ error: 'Thumbnail not found' }, { status: 404 })
    }

    const fullPath = rows[0].thumbnail_storage_path
    const objectPath = fullPath.replace(`gs://${BUCKET}/`, '')

    const client = await auth.getClient()
    const tokenResponse = await client.getAccessToken()
    const token = tokenResponse.token

    const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}?alt=media`

    const gcsResp = await fetch(gcsUrl, {
      headers: { Authorization: `Bearer ${token}` },
      cache: 'no-store',
    })

    if (!gcsResp.ok) {
      return NextResponse.json({ error: 'Thumbnail not found in storage' }, { status: 404 })
    }

    return new Response(gcsResp.body, {
      headers: {
        'Content-Type': 'image/jpeg',
        'Content-Length': gcsResp.headers.get('content-length') || '',
        'Cache-Control': 'private, max-age=86400',
      },
    })
  } catch (error) {
    console.error('Thumbnail route error:', error)
    return NextResponse.json({ error: 'Failed to get thumbnail' }, { status: 500 })
  }
}
