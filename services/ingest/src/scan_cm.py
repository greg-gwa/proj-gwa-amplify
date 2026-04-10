"""
CM Ad Scanner — core scan logic.

For each active monitor:
  Pass 1: CC keyword search ("approve this message", "paid for by")
  Pass 2: CC gap scan (find silent breaks → Whisper transcribe)
Both passes download HLS clips via ffmpeg, transcribe via Whisper, pattern-match,
and insert confirmed political ads into ad_clips.
"""

import asyncio
import logging
import os
import re
import tempfile
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import httpx
from google.cloud import storage as gcs
from rapidfuzz import fuzz, process as rfprocess

from src.cm_client import CMClient
from src.cm_channel_map import build_channel_map
from src.db import get_pool

logger = logging.getLogger(__name__)

GCS_BUCKET = "amplify-raw-emails"
GCS_PROJECT = "proj-amplify"
SCAN_WINDOW_DAYS = 7
MAX_FFMPEG = 3  # max concurrent ffmpeg processes

_ffmpeg_sem = asyncio.Semaphore(MAX_FFMPEG)

POLITICAL_PATTERNS = [
    r"i(?:'m|\s+am)\s+[\w\s]+and\s+i\s+approve\s+this\s+message",
    r"paid\s+for\s+by",
    r"authorized\s+and\s+paid\s+for\s+by",
    r"vote\s+(?:yes|no)",
    r"\w[\w\s]+for\s+(?:congress|senate|governor|president|mayor|attorney\s+general|state\s+senate|state\s+house)",
]

_POLITICAL_RE = [re.compile(p, re.IGNORECASE) for p in POLITICAL_PATTERNS]


def _is_political(transcript: str) -> bool:
    return any(r.search(transcript) for r in _POLITICAL_RE)


def _extract_paid_for_by(transcript: str) -> Optional[str]:
    """Pull 'paid for by [org]' from transcript."""
    for pattern in (
        r"authorized\s+and\s+paid\s+for\s+by\s+(.+?)(?:\.|,|$)",
        r"paid\s+for\s+by\s+(.+?)(?:\.|,|$)",
    ):
        m = re.search(pattern, transcript, re.IGNORECASE)
        if m:
            return m.group(1).strip()[:300]
    return None


async def _fuzzy_spender(pool, name: str) -> Optional[tuple[str, str]]:
    """Fuzzy-match name against spenders table. Returns (id, name) or None."""
    async with pool.acquire() as conn:
        rows = await conn.fetch("SELECT id::TEXT, name FROM spenders")
    if not rows:
        return None
    choices = {r["name"]: r["id"] for r in rows}
    hit = rfprocess.extractOne(name, choices.keys(), scorer=fuzz.token_sort_ratio, score_cutoff=80)
    if hit:
        matched_name, _score, _ = hit
        return choices[matched_name], matched_name
    return None


# ------------------------------------------------------------------
# ffmpeg helpers
# ------------------------------------------------------------------

async def _download_hls(hls_url: str, out_path: str) -> bool:
    """Download an HLS stream to MP4 via ffmpeg (semaphore-limited)."""
    async with _ffmpeg_sem:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", hls_url,
            "-c", "copy",
            "-t", "120",
            out_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=130)
        except asyncio.TimeoutError:
            proc.kill()
            logger.warning(f"ffmpeg timed out: {hls_url[:80]}")
            return False
        if proc.returncode != 0:
            logger.debug(f"ffmpeg exit {proc.returncode}: {stderr.decode()[-300:]}")
            return False
    return True


async def _extract_audio(video_path: str, audio_path: str) -> bool:
    """Extract 16 kHz mono WAV audio from video."""
    async with _ffmpeg_sem:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", video_path,
            "-vn", "-ar", "16000", "-ac", "1", "-f", "wav",
            audio_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=60)
        except asyncio.TimeoutError:
            proc.kill()
            return False
        if proc.returncode != 0:
            logger.debug(f"audio extract failed: {stderr.decode()[-200:]}")
            return False
    return True


async def _whisper_transcribe(audio_path: str) -> Optional[str]:
    """Transcribe audio via OpenAI Whisper API."""
    api_key = os.environ.get("OPENAI_API_KEY", "")
    if not api_key:
        logger.warning("OPENAI_API_KEY not set — skipping transcription")
        return None
    with open(audio_path, "rb") as f:
        audio_bytes = f.read()
    async with httpx.AsyncClient(timeout=60.0) as http:
        resp = await http.post(
            "https://api.openai.com/v1/audio/transcriptions",
            headers={"Authorization": f"Bearer {api_key}"},
            data={"model": "whisper-1"},
            files={"file": ("audio.wav", audio_bytes, "audio/wav")},
        )
    if resp.status_code != 200:
        logger.warning(f"Whisper error {resp.status_code}: {resp.text[:200]}")
        return None
    return resp.json().get("text")


def _gcs_client():
    return gcs.Client(project=GCS_PROJECT)


async def _upload_gcs(local_path: str, gcs_path: str) -> str:
    """Upload file to GCS, return gs:// URI."""
    client = _gcs_client()
    bucket = client.bucket(GCS_BUCKET)
    blob = bucket.blob(gcs_path)
    blob.upload_from_filename(local_path)
    return f"gs://{GCS_BUCKET}/{gcs_path}"


# ------------------------------------------------------------------
# Per-clip processing
# ------------------------------------------------------------------

async def _process_clip(
    pool,
    scan_id: str,
    monitor: dict,
    hls_url: str,
    air_date: date,
    air_time: str,
    detection_method: str,
    cc_transcript: Optional[str] = None,
) -> Optional[dict]:
    """
    Download, transcribe, pattern-match, and persist one ad clip.
    Returns clip dict on success, None if not a political ad or failed.
    """
    clip_uuid = str(uuid.uuid4())

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, f"{clip_uuid}.mp4")
        audio_path = os.path.join(tmpdir, f"{clip_uuid}.wav")

        # Download
        ok = await _download_hls(hls_url, video_path)
        if not ok or not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
            logger.debug(f"HLS download failed: {hls_url[:80]}")
            return None

        # Determine transcript
        if cc_transcript and len(cc_transcript.strip()) > 20:
            transcript = cc_transcript
        else:
            ok = await _extract_audio(video_path, audio_path)
            if not ok:
                return None
            transcript = await _whisper_transcribe(audio_path)
            if not transcript:
                return None

        # Pattern match
        if not _is_political(transcript):
            return None

        # Upload video to GCS
        gcs_path = f"clips/{air_date.isoformat()}/{clip_uuid}.mp4"
        try:
            video_storage_path = await _upload_gcs(video_path, gcs_path)
        except Exception as exc:
            logger.warning(f"GCS upload failed for {clip_uuid}: {exc}")
            video_storage_path = None

        # Match spender
        matched_spender_id: Optional[str] = None
        matched_spender_name: Optional[str] = None
        spender_name = monitor.get("spender_name") or ""

        # 1. Direct match against monitor's spender
        if spender_name and spender_name.lower() in transcript.lower():
            async with pool.acquire() as conn:
                row = await conn.fetchrow(
                    "SELECT id::TEXT FROM spenders WHERE UPPER(TRIM(name)) = UPPER(TRIM($1))",
                    spender_name,
                )
            if row:
                matched_spender_id = row["id"]
                matched_spender_name = spender_name

        # 2. "Paid for by" extraction + fuzzy match
        if not matched_spender_id:
            extracted = _extract_paid_for_by(transcript)
            if extracted:
                hit = await _fuzzy_spender(pool, extracted)
                if hit:
                    matched_spender_id, matched_spender_name = hit
                else:
                    matched_spender_name = extracted  # orphaned but we know the name

        # Insert into ad_clips
        now = datetime.now(timezone.utc)
        station = monitor.get("station_call_sign")
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO ad_clips (
                    id, source_platform, media_type, station_or_channel,
                    transcript, is_relevant,
                    cm_scan_id, monitor_id, spender_id,
                    detection_method, video_storage_path,
                    air_date, air_time, matched_spender_name,
                    created_at, processed_at
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6,
                    $7, $8, $9,
                    $10, $11,
                    $12, $13, $14,
                    $15, $15
                )""",
                clip_uuid,
                "critical_mention", "tv", station,
                transcript, True,
                scan_id, monitor.get("id"), matched_spender_id,
                detection_method, video_storage_path,
                air_date, air_time, matched_spender_name,
                now,
            )

        logger.info(
            f"Clip inserted: {clip_uuid} [{detection_method}] "
            f"{station} {air_date} spender={matched_spender_name or '(orphaned)'}"
        )
        return {
            "clip_id": clip_uuid,
            "matched": matched_spender_id is not None,
            "spender": matched_spender_name,
        }


# ------------------------------------------------------------------
# Per-day scan passes
# ------------------------------------------------------------------

async def _cc_search(
    pool,
    cm: CMClient,
    scan_id: str,
    monitor: dict,
    channel_id: int,
    day: date,
) -> int:
    """Pass 1: search for clips whose CC text contains political disclaimers."""
    station = monitor["station_call_sign"]
    time_start = monitor.get("time_start") or "00:00"
    time_end = monitor.get("time_end") or "23:59"
    start = f"{day.isoformat()} {time_start}:00"
    end = f"{day.isoformat()} {time_end}:00"

    try:
        clips = await cm.search(
            terms='"approve this message" OR "paid for by"',
            start=start, end=end,
            channel_id=channel_id, station=station,
            limit=100,
        )
    except Exception as exc:
        logger.warning(f"CC search failed {station} {day}: {exc}")
        return 0

    tasks = []
    for clip in clips:
        hls_url = clip.get("media") or clip.get("stream")
        if not hls_url:
            continue
        cc_text = clip.get("ccText") or clip.get("transcript") or ""
        air_time = clip.get("startTime") or clip.get("airTime") or ""
        tasks.append(_process_clip(
            pool=pool, scan_id=scan_id, monitor=monitor,
            hls_url=hls_url,
            air_date=day, air_time=air_time,
            detection_method="cc_search",
            cc_transcript=cc_text,
        ))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    found = sum(1 for r in results if isinstance(r, dict))
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"CC clip error: {r}")
    return found


async def _gap_scan(
    pool,
    cm: CMClient,
    scan_id: str,
    monitor: dict,
    channel_id: int,
    day: date,
) -> int:
    """Pass 2: find CC gaps (silent commercial breaks) and Whisper-transcribe them."""
    station = monitor["station_call_sign"]
    time_start = monitor.get("time_start") or "00:00"
    time_end = monitor.get("time_end") or "23:59"
    start = f"{day.isoformat()} {time_start}:00"
    end = f"{day.isoformat()} {time_end}:00"

    try:
        all_clips = await cm.search(
            terms="*",
            start=start, end=end,
            channel_id=channel_id, station=station,
            limit=500,
        )
    except Exception as exc:
        logger.warning(f"Gap scan failed {station} {day}: {exc}")
        return 0

    # Clips with empty CC text are potential commercial breaks
    gap_clips = [c for c in all_clips if not (c.get("ccText") or "").strip()]
    if not gap_clips:
        return 0

    tasks = []
    for clip in gap_clips:
        hls_url = clip.get("media") or clip.get("stream")
        if not hls_url:
            # Skip clips without a signed media URL — constructed URLs lack HMAC signatures
            continue

        air_time = clip.get("startTime") or clip.get("airTime") or ""
        tasks.append(_process_clip(
            pool=pool, scan_id=scan_id, monitor=monitor,
            hls_url=hls_url,
            air_date=day, air_time=air_time,
            detection_method="gap_scan",
        ))

    results = await asyncio.gather(*tasks, return_exceptions=True)
    found = sum(1 for r in results if isinstance(r, dict))
    for r in results:
        if isinstance(r, Exception):
            logger.warning(f"Gap clip error: {r}")
    return found


# ------------------------------------------------------------------
# Main entry point
# ------------------------------------------------------------------

async def run_cm_scan(scan_id: str, market_ids: list[str] | None = None) -> dict:
    """
    Execute a CM scan for active monitors scoped to the watchlist.
    If market_ids is provided, only scan monitors in those markets.
    Otherwise scan all active monitors (capped at MAX_MONITORS).
    Runs as a background asyncio task; updates cm_scans as it progresses.
    """
    MAX_MONITORS = 200  # safety cap

    pool = await get_pool()

    async with pool.acquire() as conn:
        await conn.execute(
            "UPDATE cm_scans SET status = 'running', started_at = NOW() WHERE id = $1",
            scan_id,
        )

    logger.info(f"CM scan {scan_id} started (market_ids={len(market_ids) if market_ids else 'all'})")

    try:
        today = date.today()
        window_start = today - timedelta(days=SCAN_WINDOW_DAYS)

        # Fetch active monitors — scoped to watchlist markets if provided
        async with pool.acquire() as conn:
            if market_ids:
                monitors = await conn.fetch(
                    """SELECT DISTINCT ON (m.station_call_sign, m.spender_name)
                              m.id::TEXT, m.station_call_sign, m.spender_name,
                              m.time_start, m.time_end, m.days,
                              m.flight_start, m.flight_end
                       FROM monitors m
                       WHERE m.status = 'active'
                         AND m.flight_end   >= $1
                         AND m.flight_start <= $2
                         AND m.market_id = ANY($3::uuid[])
                       ORDER BY m.station_call_sign, m.spender_name, m.created_at DESC
                       LIMIT $4""",
                    window_start, today, market_ids, MAX_MONITORS,
                )
            else:
                monitors = await conn.fetch(
                    """SELECT DISTINCT ON (m.station_call_sign, m.spender_name)
                              m.id::TEXT, m.station_call_sign, m.spender_name,
                              m.time_start, m.time_end, m.days,
                              m.flight_start, m.flight_end
                       FROM monitors m
                       WHERE m.status = 'active'
                         AND m.flight_end   >= $1
                         AND m.flight_start <= $2
                       ORDER BY m.station_call_sign, m.spender_name, m.created_at DESC
                       LIMIT $3""",
                    window_start, today, MAX_MONITORS,
                )

        monitors = [dict(m) for m in monitors]

        if not monitors:
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE cm_scans
                       SET status = 'complete', completed_at = NOW(), total_monitors = 0
                       WHERE id = $1""",
                    scan_id,
                )
            logger.info(f"CM scan {scan_id}: no active monitors found")
            return {"status": "complete", "monitors": 0, "clips_found": 0}

        # Pre-compute total days for progress tracking
        total_days = 0
        for m in monitors:
            eff_start = max(m["flight_start"], window_start)
            eff_end = min(m["flight_end"], today)
            total_days += max(0, (eff_end - eff_start).days + 1)

        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE cm_scans SET total_monitors = $1, total_days = $2 WHERE id = $3",
                len(monitors), total_days, scan_id,
            )

        clips_found = 0

        async with CMClient(pool, scan_id) as cm:
            # Build station → channel_id map (one CM request for all channels)
            channel_map = await build_channel_map(pool, cm)

            for monitor in monitors:
                station = monitor["station_call_sign"]
                channel_id = channel_map.get(station)

                if not channel_id:
                    logger.warning(f"No CM channel for {station} — skipping monitor")
                    async with pool.acquire() as conn:
                        await conn.execute(
                            "UPDATE cm_scans SET scanned_monitors = scanned_monitors + 1 WHERE id = $1",
                            scan_id,
                        )
                    continue

                eff_start = max(monitor["flight_start"], window_start)
                eff_end = min(monitor["flight_end"], today)

                current_day = eff_start
                while current_day <= eff_end:
                    if not await cm.check_budget():
                        logger.warning(f"CM scan {scan_id}: budget limit reached — stopping")
                        async with pool.acquire() as conn:
                            await conn.execute(
                                """UPDATE cm_scans
                                   SET status = 'complete', completed_at = NOW(),
                                       clips_found = $1,
                                       error_details = 'Stopped early: CM budget limit reached'
                                   WHERE id = $2""",
                                clips_found, scan_id,
                            )
                        return {"status": "complete", "clips_found": clips_found, "stopped": "budget"}

                    n_cc = await _cc_search(pool, cm, scan_id, monitor, channel_id, current_day)
                    n_gap = await _gap_scan(pool, cm, scan_id, monitor, channel_id, current_day)
                    clips_found += n_cc + n_gap

                    async with pool.acquire() as conn:
                        await conn.execute(
                            """UPDATE cm_scans
                               SET scanned_days = scanned_days + 1,
                                   clips_found  = $1
                               WHERE id = $2""",
                            clips_found, scan_id,
                        )

                    current_day += timedelta(days=1)

                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE cm_scans SET scanned_monitors = scanned_monitors + 1 WHERE id = $1",
                        scan_id,
                    )

        # Tally matched vs orphaned
        async with pool.acquire() as conn:
            clips_matched = await conn.fetchval(
                "SELECT COUNT(*) FROM ad_clips WHERE cm_scan_id = $1 AND spender_id IS NOT NULL",
                scan_id,
            )
            clips_orphaned = await conn.fetchval(
                "SELECT COUNT(*) FROM ad_clips WHERE cm_scan_id = $1 AND spender_id IS NULL",
                scan_id,
            )
            await conn.execute(
                """UPDATE cm_scans
                   SET status = 'complete', completed_at = NOW(),
                       clips_found    = $1,
                       clips_matched  = $2,
                       clips_orphaned = $3
                   WHERE id = $4""",
                clips_found, int(clips_matched), int(clips_orphaned), scan_id,
            )

        logger.info(
            f"CM scan {scan_id} complete — "
            f"{clips_found} found, {clips_matched} matched, {clips_orphaned} orphaned"
        )
        return {
            "status": "complete",
            "scan_id": scan_id,
            "clips_found": clips_found,
            "clips_matched": int(clips_matched),
            "clips_orphaned": int(clips_orphaned),
        }

    except Exception as exc:
        logger.exception(f"CM scan {scan_id} failed")
        async with pool.acquire() as conn:
            await conn.execute(
                """UPDATE cm_scans
                   SET status = 'error', completed_at = NOW(), error_details = $1
                   WHERE id = $2""",
                str(exc)[:2000], scan_id,
            )
        raise
