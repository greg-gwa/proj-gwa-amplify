import { NextRequest, NextResponse } from 'next/server'
import { query } from '@/lib/db'
import { GoogleAuth } from 'google-auth-library'

export const dynamic = 'force-dynamic'

const BUCKET = 'amplify-raw-emails'
const auth = new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/devstorage.full_control'] })

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params

    // 1. Get the clip + creative info before deleting
    const rows = await query<{
      video_storage_path: string | null
      creative_id: string | null
      resolved_video_path: string | null
    }>(
      `SELECT ac.video_storage_path, ac.creative_id,
              COALESCE(c.storage_path, ac.video_storage_path) as resolved_video_path
       FROM ad_clips ac
       LEFT JOIN creatives c ON c.id = ac.creative_id
       WHERE ac.id = $1`,
      [id]
    )

    if (rows.length === 0) {
      return NextResponse.json({ error: 'Clip not found' }, { status: 404 })
    }

    const clip = rows[0]
    const videoPath = clip.resolved_video_path || clip.video_storage_path

    // 2. Delete from GCS if there's a video file
    if (videoPath && videoPath.startsWith(`gs://${BUCKET}/`)) {
      try {
        const objectPath = videoPath.replace(`gs://${BUCKET}/`, '')
        const client = await auth.getClient()
        const tokenResponse = await client.getAccessToken()
        const token = tokenResponse.token

        const gcsUrl = `https://storage.googleapis.com/storage/v1/b/${BUCKET}/o/${encodeURIComponent(objectPath)}`
        const gcsResp = await fetch(gcsUrl, {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        })

        if (!gcsResp.ok && gcsResp.status !== 404) {
          console.error(`GCS delete failed: ${gcsResp.status} ${gcsResp.statusText}`)
          // Continue with DB deletion even if GCS fails
        }
      } catch (gcsError) {
        console.error('GCS delete error:', gcsError)
        // Continue with DB deletion
      }
    }

    // 3. Delete ad_clips rows for this creative (or just this clip if no creative)
    if (clip.creative_id) {
      // Delete all ad_clips sharing this creative
      await query('DELETE FROM ad_clips WHERE creative_id = $1', [clip.creative_id])
      // Delete the creative itself
      await query('DELETE FROM creatives WHERE id = $1', [clip.creative_id])
    } else {
      // No creative — just delete this single clip
      await query('DELETE FROM ad_clips WHERE id = $1', [id])
    }

    return NextResponse.json({ ok: true, deleted: id, creative_id: clip.creative_id })
  } catch (error) {
    console.error('Clip delete error:', error)
    return NextResponse.json({ error: 'Failed to delete clip' }, { status: 500 })
  }
}
