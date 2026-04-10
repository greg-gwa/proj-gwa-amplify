"""
Critical Mention API client.
Handles auth, search, channel listing, and budget enforcement.
Every CM API call is logged to cm_request_log for budget tracking.
"""

import logging
import os
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

CM_BASE_URL = os.environ.get("CM_BASE_URL", "https://staging-partner.criticalmention.com/allmedia")
CM_USERNAME = os.environ.get("CM_USERNAME", "")
CM_PASSWORD = os.environ.get("CM_PASSWORD", "")

CM_BUDGET_TOTAL = 1000
CM_ABORT_THRESHOLD = 50  # Stop scanning when fewer than this many requests remain


class CMClient:
    """
    Async context manager for interacting with the Critical Mention API.
    Tracks every request against the budget and logs to cm_request_log.
    """

    def __init__(self, pool, scan_id: str):
        self.pool = pool
        self.scan_id = scan_id
        self._token: Optional[str] = None
        self._http: Optional[httpx.AsyncClient] = None

    async def __aenter__(self) -> "CMClient":
        self._http = httpx.AsyncClient(timeout=30.0)
        await self._authenticate()
        return self

    async def __aexit__(self, *_args) -> None:
        if self._http:
            await self._http.aclose()

    # ------------------------------------------------------------------
    # Auth
    # ------------------------------------------------------------------

    async def _authenticate(self) -> None:
        """POST /session → store token."""
        await self._log_request("session", None, None)
        resp = await self._http.post(
            f"{CM_BASE_URL}/session",
            data={"username": CM_USERNAME, "password": CM_PASSWORD},
        )
        resp.raise_for_status()
        data = resp.json()
        self._token = data.get("id") or data.get("token")
        if not self._token:
            raise ValueError(f"CM auth failed — no token in response: {data}")
        logger.info(f"CM authenticated (token prefix: {self._token[:8]}…)")

    # ------------------------------------------------------------------
    # Budget
    # ------------------------------------------------------------------

    async def _log_request(self, endpoint: str, channel_id: Optional[int], station: Optional[str]) -> None:
        """Insert a row into cm_request_log and increment cm_scans.cm_requests_used."""
        async with self.pool.acquire() as conn:
            await conn.execute(
                """INSERT INTO cm_request_log (scan_id, endpoint, channel_id, station)
                   VALUES ($1, $2, $3, $4)""",
                self.scan_id, endpoint, channel_id, station,
            )
            await conn.execute(
                "UPDATE cm_scans SET cm_requests_used = cm_requests_used + 1 WHERE id = $1",
                self.scan_id,
            )

    async def get_requests_used(self) -> int:
        """Total CM requests ever made (all scans, all time)."""
        async with self.pool.acquire() as conn:
            row = await conn.fetchrow("SELECT COUNT(*)::INTEGER as cnt FROM cm_request_log")
            return row["cnt"] if row else 0

    async def check_budget(self) -> bool:
        """Return True if it is safe to make another CM request."""
        used = await self.get_requests_used()
        remaining = CM_BUDGET_TOTAL - used
        if remaining < CM_ABORT_THRESHOLD:
            logger.warning(f"CM budget low: {remaining} requests remaining")
        return remaining >= CM_ABORT_THRESHOLD

    # ------------------------------------------------------------------
    # Auth header helper
    # ------------------------------------------------------------------

    @property
    def _auth_header(self) -> dict:
        return {"Authorization": self._token}

    # ------------------------------------------------------------------
    # API calls
    # ------------------------------------------------------------------

    async def get_channels(self) -> list[dict]:
        """GET /channel — list all CM broadcast channels."""
        if not await self.check_budget():
            raise RuntimeError("CM budget exhausted — aborting scan")
        await self._log_request("channels", None, None)
        resp = await self._http.get(
            f"{CM_BASE_URL}/channel",
            headers=self._auth_header,
            params={"limit": 2000},
        )
        resp.raise_for_status()
        data = resp.json()
        # Response is a flat list or nested under 'channels'
        return data if isinstance(data, list) else data.get("channels", [])

    async def search(
        self,
        terms: str,
        start: str,
        end: str,
        channel_id: int,
        station: str,
        limit: int = 100,
    ) -> list[dict]:
        """
        POST /search — keyword search against CC transcripts.
        start/end: 'YYYY-MM-DD HH:MM:SS'
        """
        if not await self.check_budget():
            raise RuntimeError("CM budget exhausted — aborting scan")
        await self._log_request("search", channel_id, station)
        resp = await self._http.post(
            f"{CM_BASE_URL}/search",
            headers=self._auth_header,
            data={
                "terms": terms,
                "start": start,
                "end": end,
                "cTV": 1,
                "tvChannels": channel_id,
                "limit": limit,
            },
        )
        resp.raise_for_status()
        data = resp.json()
        # Response shape: {"message": "OK", "results": {"clips": [...]}}
        return data.get("results", {}).get("clips", [])

    async def build_stream_url(
        self,
        clip: dict,
        channel_id: int,
        station: str,
        log_request: bool = True,
    ) -> Optional[str]:
        """
        Return an HLS m3u8 URL for a clip constructed from epoch timestamps.
        NOTE: URLs constructed here lack HMAC signatures and will likely be rejected
        by the CM CDN. Prefer using the 'media' field from search results, which
        already has auth baked in.
        """
        start_epoch = clip.get("startEpochMs") or clip.get("startEpoch")
        stop_epoch = clip.get("stopEpochMs") or clip.get("stopEpoch")
        asset_host = clip.get("assetHost") or "streaming.criticalmention.com"

        if not (start_epoch and stop_epoch):
            return None

        if log_request:
            if not await self.check_budget():
                raise RuntimeError("CM budget exhausted — aborting scan")
            await self._log_request("stream", channel_id, station)

        return (
            f"https://{asset_host}/stream.php"
            f"?channel_id={channel_id}"
            f"&start={start_epoch}"
            f"&stop={stop_epoch}"
            f"&fmt=m3u8"
        )
