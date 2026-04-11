"""
CM Ad Scanner — core scan logic.

For each active monitor window (derived live from radar_items + buy_lines):
  Pass 1: CC keyword search ("approve this message", "paid for by")
  Pass 2: CC gap scan (find silent breaks → Whisper transcribe)
Both passes download HLS clips via ffmpeg, transcribe via Whisper, pattern-match,
and insert confirmed political ads into ad_clips.
"""

import asyncio
import json
import logging
import os
import re
import tempfile
import uuid
from datetime import date, datetime, timedelta, timezone
from typing import Optional

import anthropic
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


# ------------------------------------------------------------------
# Haiku political ad classifier
# ------------------------------------------------------------------

_anthropic_client = anthropic.Anthropic()

_CLASSIFY_PROMPT = """Classify this TV broadcast transcript. Is it a POLITICAL AD?

A political ad is a PAID ADVERTISEMENT — a commercial spot — about a political candidate, ballot measure, PAC, or political issue advocacy. It typically mentions candidates by name, uses phrases like "vote for/against", "paid for by", "I approve this message", or attacks/promotes a political figure running for office.

NOT political ads (even if they discuss politics):
- News segments, anchors discussing politics, panel discussions, interviews
- Product commercials, lawyer ads, car dealer ads, local business ads
- TV show promos, PSAs, public affairs programming
- Commentary or opinion segments from news broadcasts

Key distinction: A political AD is a paid commercial spot trying to persuade voters. A news segment ABOUT politics is NOT a political ad.

The transcript may contain MULTIPLE ads or content spliced together. If there IS a political ad, identify exactly where it starts and ends by quoting the first few words and last few words.

Transcript:
{transcript}

Respond with ONLY valid JSON:
{{
  "is_political": true/false,
  "confidence": 0.0-1.0,
  "reason": "one sentence",
  "ad_start_words": "first 5-8 words of the political ad portion",
  "ad_end_words": "last 5-8 words of the political ad portion",
  "ad_slug": "short-kebab-case-id-for-this-specific-ad"
}}

ad_slug: A unique identifier for THIS SPECIFIC AD CREATIVE — not the candidate, but the specific commercial. Base it on the key message/attack/claim. Examples: "jones-shady-land-deals", "jackson-trump-endorsement", "jones-vape-ban". Two different ads about the same candidate should have DIFFERENT slugs. The same ad with slightly different transcriptions should have the SAME slug.

If is_political is false, set ad_start_words, ad_end_words, and ad_slug to null."""


async def _classify_political(transcript: str) -> dict:
    """
    Use Claude Haiku to classify whether a transcript is a political ad.
    Returns dict with is_political, confidence, reason, ad_start_words, ad_end_words.
    """
    try:
        response = _anthropic_client.messages.create(
            model="claude-haiku-4-5-20251001",
            max_tokens=300,
            messages=[{
                "role": "user",
                "content": _CLASSIFY_PROMPT.format(transcript=transcript[:2000]),
            }],
        )
        content = response.content[0].text
        match = re.search(r"\{[\s\S]*\}", content)
        if match:
            parsed = json.loads(match.group(0))
            return {
                "is_political": bool(parsed.get("is_political", False)),
                "confidence": float(parsed.get("confidence", 0.0)),
                "reason": str(parsed.get("reason", "")),
                "ad_start_words": parsed.get("ad_start_words"),
                "ad_end_words": parsed.get("ad_end_words"),
            }
    except Exception as exc:
        logger.warning(f"Haiku classification failed: {exc}")
    # Default: let it through (fail open) so we don't lose real ads
    return {"is_political": True, "confidence": 0.0, "reason": "classification_error", "ad_start_words": None, "ad_end_words": None}


def _find_timestamp(words: list[dict], target_phrase: str, from_end: bool = False) -> Optional[float]:
    """Find the timestamp in Whisper words that best matches a target phrase.
    Returns start time (seconds) for ad_start, end time for ad_end.
    
    Uses sliding window with normalized word comparison for robust matching.
    """
    if not words or not target_phrase:
        return None
    
    def _clean(w: str) -> str:
        return re.sub(r"[^\w]", "", w.lower())
    
    target_tokens = [_clean(t) for t in target_phrase.split() if _clean(t)]
    if len(target_tokens) < 2:
        return None

    best_score = 0
    best_ts = None
    best_idx = -1

    for i in range(len(words)):
        # Build a window matching the target phrase length
        window_size = len(target_tokens)
        window = words[i:i + window_size]
        if len(window) < window_size:
            continue
        window_tokens = [_clean(w.get("word", "")) for w in window]

        # Count sequential matches (order matters)
        matches = 0
        for t, wt in zip(target_tokens, window_tokens):
            if t == wt or t in wt or wt in t:
                matches += 1

        if matches > best_score:
            best_score = matches
            best_idx = i
            if from_end:
                # For ad end, use the end timestamp of the LAST word in the matched window
                last_word = words[min(i + window_size - 1, len(words) - 1)]
                best_ts = last_word.get("end", last_word.get("start"))
            else:
                best_ts = words[i].get("start")

    # Require at least 60% sequential match
    if best_score >= len(target_tokens) * 0.6:
        return best_ts
    return None


async def _fingerprint_audio(audio_path: str) -> Optional[str]:
    """Generate a Chromaprint audio fingerprint from a WAV file.
    Returns the compressed fingerprint string, or None on failure.
    """
    try:
        proc = await asyncio.create_subprocess_exec(
            "fpcalc", "-raw", "-json", audio_path,
            stdout=asyncio.subprocess.PIPE,
            stderr=asyncio.subprocess.PIPE,
        )
        stdout, stderr = await asyncio.wait_for(proc.communicate(), timeout=15)
        if proc.returncode != 0:
            logger.debug(f"fpcalc failed: {stderr.decode()[:200]}")
            return None
        data = json.loads(stdout.decode())
        # Return the fingerprint as a comma-separated string of ints
        fp = data.get("fingerprint", [])
        if not fp:
            return None
        return ",".join(str(x) for x in fp)
    except Exception as exc:
        logger.warning(f"Fingerprint generation failed: {exc}")
        return None


def _fingerprint_similarity(fp1: str, fp2: str) -> float:
    """Compare two raw chromaprint fingerprints. Returns 0.0-1.0 similarity.
    Uses bit-level comparison of the integer fingerprint arrays.
    """
    if not fp1 or not fp2:
        return 0.0
    try:
        a = [int(x) for x in fp1.split(",")]
        b = [int(x) for x in fp2.split(",")]
    except ValueError:
        return 0.0
    min_len = min(len(a), len(b))
    if min_len == 0:
        return 0.0
    # Compare overlapping portion using popcount of XOR
    matching_bits = 0
    total_bits = 0
    for i in range(min_len):
        xor = a[i] ^ b[i]
        matching_bits += 32 - bin(xor).count("1")
        total_bits += 32
    return matching_bits / total_bits if total_bits > 0 else 0.0


async def _find_or_create_creative(
    pool,
    fingerprint: Optional[str],
    transcript: str,
    spender_id: Optional[str],
    spender_name: Optional[str],
    station: str,
    air_date: date,
    video_storage_path: Optional[str],
    classification: dict,
) -> tuple[str, bool]:
    """Find an existing creative by fingerprint match, or create a new one.
    Returns (creative_id, is_new).
    """
    SIMILARITY_THRESHOLD = 0.85

    # Try fingerprint match against existing creatives
    if fingerprint:
        async with pool.acquire() as conn:
            rows = await conn.fetch(
                "SELECT id::TEXT, audio_fingerprint FROM creatives WHERE audio_fingerprint IS NOT NULL"
            )
        for row in rows:
            sim = _fingerprint_similarity(fingerprint, row["audio_fingerprint"])
            if sim >= SIMILARITY_THRESHOLD:
                creative_id = row["id"]
                # Increment airing count
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE creatives SET airing_count = airing_count + 1, last_detected_at = NOW() WHERE id = $1",
                        uuid.UUID(creative_id),
                    )
                logger.info(f"Fingerprint match: creative {creative_id[:8]} (similarity={sim:.3f})")
                return creative_id, False

    # No match — create new creative
    creative_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    async with pool.acquire() as conn:
        await conn.execute(
            """INSERT INTO creatives (
                id, spender_id, transcript, audio_fingerprint,
                storage_path, station_first_seen, date_first_aired,
                airing_count, first_detected_at, last_detected_at,
                sentiment, ad_type, source_platform,
                created_at, updated_at
            ) VALUES (
                $1, $2, $3, $4,
                $5, $6, $7,
                $8, $9, $9,
                $10, $11, $12,
                $9, $9
            )""",
            uuid.UUID(creative_id),
            uuid.UUID(spender_id) if spender_id else None,
            transcript,
            fingerprint,
            video_storage_path,
            station,
            air_date,
            1,  # first airing
            now,
            classification.get("reason"),
            None,  # ad_type — could extract from classification later
            "critical_mention",
        )
    logger.info(f"New creative created: {creative_id[:8]}")
    return creative_id, True


async def _trim_video(video_path: str, out_path: str, start_sec: float, end_sec: float) -> bool:
    """Trim video to [start_sec, end_sec] using ffmpeg."""
    duration = end_sec - start_sec
    if duration < 5:  # too short, probably a bad boundary
        return False
    async with _ffmpeg_sem:
        proc = await asyncio.create_subprocess_exec(
            "ffmpeg", "-y",
            "-i", video_path,
            "-ss", str(max(0, start_sec + 0.3)),  # skip slightly INTO the ad to avoid previous commercial bleed
            "-t", str(duration + 3.0),  # generous buffer at the end so we don't clip the ending
            "-c", "copy",
            out_path,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.PIPE,
        )
        try:
            _, stderr = await asyncio.wait_for(proc.communicate(), timeout=30)
        except asyncio.TimeoutError:
            proc.kill()
            return False
        if proc.returncode != 0:
            logger.debug(f"trim failed: {stderr.decode()[-200:]}")
            return False
    return True


# ------------------------------------------------------------------
# Time string parser (copied from build_monitors.py — that file is deleted)
# ------------------------------------------------------------------

def parse_time(time_str: str):
    """Parse time strings like '7a-730a', '10p-1030p', '8-830pm' into (HH:MM, HH:MM).

    If only the end time has an AM/PM suffix, the start time inherits it.
    e.g., '8-830pm' → 20:00-20:30 (not 08:00-20:30)
    """
    if not time_str:
        return None
    t = time_str.strip().upper().replace(" ", "")
    parts = t.split("-")
    if len(parts) != 2:
        return None

    start_raw, end_raw = parts[0].strip(), parts[1].strip()

    start_has_pm = "P" in start_raw
    start_has_am = "A" in start_raw
    end_has_pm = "P" in end_raw
    end_has_am = "A" in end_raw

    # If start has no AM/PM suffix, inherit from end
    if not start_has_pm and not start_has_am:
        if end_has_pm:
            start_has_pm = True
        elif end_has_am:
            start_has_am = True

    def convert(p, forced_pm=False, forced_am=False):
        p = p.strip()
        is_pm = "P" in p or forced_pm
        is_am = "A" in p or forced_am
        p = p.replace("A", "").replace("P", "").replace("M", "")
        if not p:
            return None
        if ":" in p:
            h, m = p.split(":")
        elif len(p) <= 2:
            h, m = p, "00"
        elif len(p) == 3:
            h, m = p[0], p[1:]
        elif len(p) == 4:
            h, m = p[:2], p[2:]
        else:
            return None
        try:
            h, m = int(h), int(m)
        except ValueError:
            return None
        if is_pm and h < 12:
            h += 12
        if is_am and h == 12:
            h = 0
        return f"{h:02d}:{m:02d}"

    start = convert(start_raw, forced_pm=start_has_pm and "P" not in start_raw, forced_am=start_has_am and "A" not in start_raw)
    end = convert(end_raw)

    if start and end:
        # Sanity: if end < start and start wasn't explicitly AM, start is probably PM too
        if end < start and not (start_has_am or "A" in start_raw):
            sh = int(start[:2])
            if sh < 12:
                start = f"{sh + 12:02d}:{start[3:]}"
        return (start, end)
    return None


# ------------------------------------------------------------------
# Spender fuzzy match
# ------------------------------------------------------------------

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


async def _whisper_transcribe(audio_path: str) -> Optional[dict]:
    """Transcribe audio via OpenAI Whisper API with word-level timestamps.
    Returns {"text": str, "words": [{"word": str, "start": float, "end": float}, ...]} or None.
    """
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
            data={"model": "whisper-1", "response_format": "verbose_json", "timestamp_granularities[]": "word"},
            files={"file": ("audio.wav", audio_bytes, "audio/wav")},
        )
    if resp.status_code != 200:
        logger.warning(f"Whisper error {resp.status_code}: {resp.text[:200]}")
        return None
    data = resp.json()
    return {
        "text": data.get("text", ""),
        "words": data.get("words", []),
    }


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

    # Dedup: skip if we already have a clip for the same station + date + time
    station = monitor.get("station_call_sign")
    if air_time and air_date:
        async with pool.acquire() as conn:
            existing = await conn.fetchval(
                """SELECT id FROM ad_clips
                   WHERE station_or_channel = $1 AND air_date = $2 AND air_time = $3
                   LIMIT 1""",
                station, air_date, air_time,
            )
        if existing:
            logger.debug(f"Dedup: skipping {station} {air_date} {air_time} — already captured as {existing}")
            return None

    with tempfile.TemporaryDirectory() as tmpdir:
        video_path = os.path.join(tmpdir, f"{clip_uuid}.mp4")
        audio_path = os.path.join(tmpdir, f"{clip_uuid}.wav")

        # If we already have a CC transcript, skip the expensive HLS download
        # (Pass 1 provides CC text; Pass 2 gap scan needs Whisper so must download)
        whisper_words: list[dict] = []
        if cc_transcript and len(cc_transcript.strip()) > 20:
            transcript = cc_transcript
            video_storage_path = None  # No video for CC-detected clips (download later if needed)
        else:
            # Download HLS stream
            ok = await _download_hls(hls_url, video_path)
            if not ok or not os.path.exists(video_path) or os.path.getsize(video_path) == 0:
                logger.debug(f"HLS download failed: {hls_url[:80]}")
                return None

            # Extract audio and transcribe (with word timestamps)
            ok = await _extract_audio(video_path, audio_path)
            if not ok:
                return None
            whisper_result = await _whisper_transcribe(audio_path)
            if not whisper_result:
                return None
            transcript = whisper_result["text"]
            whisper_words = whisper_result.get("words", [])

            # Don't upload yet — classify first, then trim if needed
            video_storage_path = None

        # Classify: is this actually a political ad?
        classification = await _classify_political(transcript)
        if not classification["is_political"]:
            logger.info(
                f"Clip {clip_uuid} classified as NOT political "
                f"(confidence={classification['confidence']:.2f}, reason={classification['reason']})"
            )
            return None

        logger.info(
            f"Clip {clip_uuid} classified as political "
            f"(confidence={classification['confidence']:.2f}, reason={classification['reason']})"
        )

        # Trim to just the political ad portion
        ad_transcript = transcript  # default: full transcript
        ad_start_words = classification.get("ad_start_words") or ""
        ad_end_words = classification.get("ad_end_words") or ""

        if whisper_words and os.path.exists(video_path):
            # Gap scan path: use word timestamps to trim video + transcript
            start_sec = _find_timestamp(whisper_words, ad_start_words, from_end=False)
            end_sec = _find_timestamp(whisper_words, ad_end_words, from_end=True)

            if start_sec is not None and end_sec is not None and end_sec > start_sec:
                trimmed_path = os.path.join(tmpdir, f"{clip_uuid}_trimmed.mp4")
                trimmed_ok = await _trim_video(video_path, trimmed_path, start_sec, end_sec)
                if trimmed_ok and os.path.exists(trimmed_path) and os.path.getsize(trimmed_path) > 0:
                    logger.info(f"Trimmed clip {clip_uuid}: {start_sec:.1f}s → {end_sec:.1f}s")
                    video_path = trimmed_path
                    ad_words = [w for w in whisper_words if w.get("start", 0) >= start_sec - 0.5 and w.get("end", 0) <= end_sec + 0.5]
                    if ad_words:
                        ad_transcript = " ".join(w.get("word", "") for w in ad_words)
                else:
                    logger.debug(f"Trim failed for {clip_uuid}, using full clip")
            else:
                logger.debug(f"Could not find ad boundaries for {clip_uuid}, using full clip")

        elif ad_start_words and ad_end_words:
            # CC search path: no video to trim, but extract the ad text from the full CC segment
            lower_transcript = transcript.lower()
            start_idx = lower_transcript.find(ad_start_words.lower()[:30])
            end_idx = lower_transcript.find(ad_end_words.lower()[:30])
            if start_idx >= 0 and end_idx > start_idx:
                # Find the end of the end phrase
                end_idx = end_idx + len(ad_end_words) + 20  # small buffer
                ad_transcript = transcript[start_idx:min(end_idx, len(transcript))].strip()
                logger.info(f"CC transcript trimmed for {clip_uuid}: {len(transcript)} → {len(ad_transcript)} chars")
            else:
                logger.debug(f"Could not find CC ad boundaries for {clip_uuid}, using full transcript")

        # Get ad slug from classification for creative dedup
        ad_slug = classification.get("ad_slug") or ""
        # Also generate transcript hash as fallback
        import hashlib
        norm_transcript = re.sub(r"[^\w\s]", "", ad_transcript.lower())
        norm_transcript = " ".join(norm_transcript.split())
        transcript_hash = hashlib.md5(norm_transcript[:200].encode()).hexdigest()

        # Generate audio fingerprint (for metadata)
        fingerprint: Optional[str] = None
        if os.path.exists(audio_path):
            fingerprint = await _fingerprint_audio(audio_path)

        # Check ad_slug against existing creatives (primary dedup)
        creative_id: Optional[str] = None
        is_new_creative = True
        if ad_slug:
            async with pool.acquire() as conn:
                existing_creative = await conn.fetchrow(
                    "SELECT id::TEXT FROM creatives WHERE transcript_hash = $1 LIMIT 1",
                    ad_slug,
                )
            if existing_creative:
                creative_id = existing_creative["id"]
                is_new_creative = False
                async with pool.acquire() as conn:
                    await conn.execute(
                        "UPDATE creatives SET airing_count = airing_count + 1, last_detected_at = NOW() WHERE id = $1",
                        uuid.UUID(creative_id),
                    )
                logger.info(f"Slug match: creative {creative_id[:8]} (slug={ad_slug}) — repeat airing")

        # Upload video to GCS (only for new creatives)
        if os.path.exists(video_path):
            if is_new_creative:
                gcs_path = f"clips/{air_date.isoformat()}/{clip_uuid}.mp4"
                try:
                    video_storage_path = await _upload_gcs(video_path, gcs_path)
                except Exception as exc:
                    logger.warning(f"GCS upload failed for {clip_uuid}: {exc}")
                    video_storage_path = None
            else:
                video_storage_path = None  # reuse existing creative's video

        # Use the ad-specific transcript if we trimmed
        transcript = ad_transcript

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

        # Create new creative if this is a unique ad
        if is_new_creative:
            creative_id = str(uuid.uuid4())
            now_c = datetime.now(timezone.utc)
            async with pool.acquire() as conn:
                await conn.execute(
                    """INSERT INTO creatives (
                        id, spender_id, transcript, transcript_hash, audio_fingerprint,
                        title, storage_path, station_first_seen, date_first_aired,
                        airing_count, first_detected_at, last_detected_at,
                        source_platform, created_at, updated_at
                    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11,$12,$11,$11)""",
                    uuid.UUID(creative_id),
                    uuid.UUID(matched_spender_id) if matched_spender_id else None,
                    transcript,
                    ad_slug or transcript_hash,  # slug preferred, hash fallback
                    fingerprint,
                    ad_slug.replace("-", " ").title() if ad_slug else None,  # human-readable title
                    video_storage_path,
                    station,
                    air_date,
                    1,
                    now_c,
                    "critical_mention",
                )
            logger.info(f"New creative: {creative_id[:8]} (slug={ad_slug or transcript_hash[:8]})")

        # Resolve radar_item_id from monitor context
        radar_item_id = monitor.get("radar_item_id")

        # Insert airing record into ad_clips
        now = datetime.now(timezone.utc)
        async with pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO ad_clips (
                    id, source_platform, media_type, station_or_channel,
                    transcript, is_relevant,
                    cm_scan_id, monitor_id, spender_id,
                    detection_method, video_storage_path,
                    air_date, air_time, matched_spender_name,
                    creative_id, audio_fingerprint, radar_item_id,
                    created_at, processed_at
                ) VALUES (
                    $1, $2, $3, $4,
                    $5, $6,
                    $7, $8, $9,
                    $10, $11,
                    $12, $13, $14,
                    $15, $16, $17,
                    $18, $18
                )""",
                clip_uuid,
                "critical_mention", "tv", station,
                transcript, True,
                scan_id, monitor.get("id"), matched_spender_id,
                detection_method, video_storage_path,
                air_date, air_time, matched_spender_name,
                uuid.UUID(creative_id) if creative_id else None,
                fingerprint,
                uuid.UUID(radar_item_id) if radar_item_id else None,
                now,
            )

        logger.info(
            f"Clip inserted: {clip_uuid} [{detection_method}] "
            f"{station} {air_date} spender={matched_spender_name or '(orphaned)'} "
            f"creative={creative_id[:8] if creative_id else 'none'} "
            f"{'(new)' if is_new_creative else '(repeat airing)'}"
        )
        return {
            "clip_id": clip_uuid,
            "matched": matched_spender_id is not None,
            "spender": matched_spender_name,
            "creative_id": creative_id,
            "is_new_creative": is_new_creative,
        }


def _day_matches(days_str: str, check_date: date) -> bool:
    """Check if a date falls on a day allowed by the days field.
    
    Formats:
      Bitmask: '1------' (Mon), '-1-----' (Tue), '--1----' (Wed), etc.
              '1' at position 0=Mon, 1=Tue, 2=Wed, 3=Thu, 4=Fri, 5=Sat, 6=Sun
      Empty/null: matches all days
      Date strings (e.g. '03/05/26'): ignored, match all days
    """
    if not days_str or len(days_str) != 7:
        return True  # no filter = all days
    # check_date.weekday(): 0=Mon, 1=Tue, ... 6=Sun — matches bitmask positions
    dow = check_date.weekday()
    return days_str[dow] == '1'


def _parse_cm_air_time(raw: str) -> str:
    """Parse CM air time formats into HH:MM:SS.
    Handles: '20260406100000' → '10:00:00', '2026-04-06T10:00:00' → '10:00:00',
    or pass through if already short.
    """
    if not raw:
        return ""
    raw = raw.strip()
    # Format: YYYYMMDDHHMMSS
    if len(raw) == 14 and raw.isdigit():
        return f"{raw[8:10]}:{raw[10:12]}:{raw[12:14]}"
    # ISO format
    if "T" in raw:
        time_part = raw.split("T")[1][:8]
        return time_part
    # Already short
    if len(raw) <= 8:
        return raw
    return raw


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
        air_time = _parse_cm_air_time(clip.get("startTime") or clip.get("airTime") or "")
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

        air_time = _parse_cm_air_time(clip.get("startTime") or clip.get("airTime") or "")
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
# Build monitor list from source tables (no monitors table)
# ------------------------------------------------------------------

async def _fetch_monitors(pool, window_start: date, today: date, market_ids: list[str] | None) -> list[dict]:
    """
    Query radar_items + buy_lines directly to produce a deduplicated list of
    (station_call_sign, spender_name, time_start, time_end, days, flight_start, flight_end).

    parse_time() is applied in Python to the FCC line_item time strings.
    Results are deduped by (station_call_sign, spender_name, time_start, time_end)
    and capped at MAX_MONITORS.
    """
    MAX_MONITORS = 200

    market_clause = "AND ri.market_id = ANY($3::uuid[])" if market_ids else ""
    buy_market_clause = "AND bl.market_id = ANY($3::uuid[])" if market_ids else ""
    date_args: list = [window_start, today]
    if market_ids:
        date_args.append(market_ids)

    async with pool.acquire() as conn:
        fcc_rows = await conn.fetch(
            f"""SELECT ri.station_call_sign, ri.spender_name,
                       ri.flight_start, ri.flight_end,
                       ri.parsed_data->'line_items' AS line_items_json
                FROM radar_items ri
                WHERE ri.parsed_data IS NOT NULL
                  AND jsonb_typeof(ri.parsed_data->'line_items') = 'array'
                  AND jsonb_array_length(ri.parsed_data->'line_items') > 0
                  AND ri.flight_end   >= $1
                  AND ri.flight_start <= $2
                  {market_clause}""",
            *date_args,
        )

        buy_rows = await conn.fetch(
            f"""SELECT bl.station_call_sign, b.spender_name,
                       bl.flight_start, bl.flight_end,
                       bld.time_start, bld.time_end, bld.days
                FROM buy_lines bl
                JOIN buys b ON bl.buy_id = b.id
                JOIN buy_line_dayparts bld ON bld.buy_line_id = bl.id
                WHERE bl.flight_end   >= $1
                  AND bl.flight_start <= $2
                  {buy_market_clause}""",
            *date_args,
        )

    monitors_raw: list[dict] = []

    # Expand FCC line items, parse time strings
    for row in fcc_rows:
        line_items = row["line_items_json"]
        if isinstance(line_items, str):
            line_items = json.loads(line_items)
        if not isinstance(line_items, list):
            continue
        for li in line_items:
            time_str = li.get("time", "")
            parsed = parse_time(time_str)
            if not parsed:
                continue
            time_start, time_end = parsed
            monitors_raw.append({
                "id": None,
                "station_call_sign": row["station_call_sign"],
                "spender_name": row["spender_name"],
                "time_start": time_start,
                "time_end": time_end,
                "days": li.get("days", ""),
                "flight_start": row["flight_start"],
                "flight_end": row["flight_end"],
            })

    # Add buy-line daypart entries
    for row in buy_rows:
        monitors_raw.append({
            "id": None,
            "station_call_sign": row["station_call_sign"],
            "spender_name": row["spender_name"],
            "time_start": row["time_start"] or "00:00",
            "time_end": row["time_end"] or "23:59",
            "days": row["days"] or "",
            "flight_start": row["flight_start"],
            "flight_end": row["flight_end"],
        })

    # Dedup by (station_call_sign, spender_name, time_start, time_end)
    seen: set[tuple] = set()
    monitors: list[dict] = []
    for m in monitors_raw:
        key = (m["station_call_sign"], m["spender_name"], m["time_start"], m["time_end"])
        if key not in seen:
            seen.add(key)
            monitors.append(m)

    logger.info(
        f"_fetch_monitors: {len(fcc_rows)} FCC rows → {sum(1 for m in monitors_raw if True)} expanded, "
        f"{len(buy_rows)} buy rows, {len(monitors)} after dedup (cap {MAX_MONITORS})"
    )
    return monitors[:MAX_MONITORS]


# ------------------------------------------------------------------
# Main entry point
# ------------------------------------------------------------------

async def run_cm_scan(scan_id: str, market_ids: list[str] | None = None) -> dict:
    """
    Execute a CM scan for active monitor windows derived from radar_items + buy_lines.
    If market_ids is provided, only scan monitors in those markets.
    Otherwise scan all active windows (capped at MAX_MONITORS).
    Runs as a background asyncio task; updates cm_scans as it progresses.
    """
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

        monitors = await _fetch_monitors(pool, window_start, today, market_ids)

        if not monitors:
            async with pool.acquire() as conn:
                await conn.execute(
                    """UPDATE cm_scans
                       SET status = 'complete', completed_at = NOW(), total_monitors = 0
                       WHERE id = $1""",
                    scan_id,
                )
            logger.info(f"CM scan {scan_id}: no active monitor windows found")
            return {"status": "complete", "monitors": 0, "clips_found": 0}

        # Pre-compute total days for progress tracking (only counting matching days-of-week)
        total_days = 0
        for m in monitors:
            eff_start = max(m["flight_start"], window_start)
            eff_end = min(m["flight_end"], today)
            d = eff_start
            while d <= eff_end:
                if _day_matches(m.get("days", ""), d):
                    total_days += 1
                d += timedelta(days=1)

        async with pool.acquire() as conn:
            await conn.execute(
                "UPDATE cm_scans SET total_monitors = $1, total_days = $2 WHERE id = $3",
                len(monitors), total_days, scan_id,
            )

        clips_found = 0

        async with CMClient(pool, scan_id) as cm:
            # Build station → channel_id map (one CM request for all channels)
            channel_map = await build_channel_map(pool, cm)

            for mi, monitor in enumerate(monitors):
                station = monitor["station_call_sign"]
                channel_id = channel_map.get(station)

                logger.info(
                    f"[scan {scan_id[:8]}] Monitor {mi+1}/{len(monitors)}: "
                    f"{station} / {monitor['spender_name'][:40]} / "
                    f"{monitor['time_start']}-{monitor['time_end']} / "
                    f"{monitor['flight_start']}→{monitor['flight_end']}"
                )

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
                    # Skip days that don't match the monitor's day-of-week schedule
                    if not _day_matches(monitor.get("days", ""), current_day):
                        current_day += timedelta(days=1)
                        continue

                    # Check if scan was killed externally
                    async with pool.acquire() as conn:
                        scan_status = await conn.fetchval(
                            "SELECT status FROM cm_scans WHERE id = $1", scan_id,
                        )
                    if scan_status in ("error", "complete"):
                        logger.info(f"[scan {scan_id[:8]}] Scan was killed externally — stopping")
                        return {"status": "killed", "clips_found": clips_found}

                    logger.info(f"[scan {scan_id[:8]}] {station} day={current_day} — starting CC search")
                    try:
                        n_cc = await _cc_search(pool, cm, scan_id, monitor, channel_id, current_day)
                    except Exception as exc:
                        logger.exception(f"[scan {scan_id[:8]}] CC search error {station} {current_day}: {exc}")
                        n_cc = 0

                    logger.info(f"[scan {scan_id[:8]}] {station} day={current_day} — CC found {n_cc}, starting gap scan")
                    try:
                        n_gap = await _gap_scan(pool, cm, scan_id, monitor, channel_id, current_day)
                    except Exception as exc:
                        logger.exception(f"[scan {scan_id[:8]}] Gap scan error {station} {current_day}: {exc}")
                        n_gap = 0

                    clips_found += n_cc + n_gap
                    logger.info(f"[scan {scan_id[:8]}] {station} day={current_day} — done (cc={n_cc} gap={n_gap} total={clips_found})")

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
