"""
FCC Public File API client for political ad filing discovery.

API base: https://publicfiles.fcc.gov/api
No authentication required.
"""

import logging
from datetime import datetime, timezone
from typing import Optional

import httpx

logger = logging.getLogger(__name__)

FCC_BASE = "https://publicfiles.fcc.gov/api"

# In-memory cache: call_sign -> entity_id
_station_cache: dict[str, str] = {}


def parse_folder_path(file_folder_path: str) -> dict:
    """
    Parse the FCC file_folder_path to extract filing metadata.

    Example paths:
      'Political Files/2026/Federal/US Senate/Virginians for Harris'
      'Political Files/2026/Non-Candidate Issue Ads/Virginians for Fair Elections'
      'Political Files/2026/State/Governor/Some PAC'
    """
    parts = [p.strip() for p in file_folder_path.split("/") if p.strip()]
    result = {
        "year": None,
        "office_type": None,   # Federal, State, Non-Candidate
        "race_type": None,     # US House, US Senate, Governor, Issue Ads, etc.
        "advertiser_name": None,
    }

    if len(parts) < 2:
        return result

    # parts[0] is typically "Political Files"
    # parts[1] is year
    if len(parts) >= 2:
        try:
            result["year"] = int(parts[1])
        except ValueError:
            pass

    if len(parts) >= 3:
        category = parts[2]
        if "Non-Candidate" in category or "Issue" in category:
            result["office_type"] = "Non-Candidate"
            result["race_type"] = "Issue Ads"
            # Advertiser is the next part
            if len(parts) >= 4:
                result["advertiser_name"] = parts[3]
        elif category in ("Federal", "State"):
            result["office_type"] = category
            if len(parts) >= 4:
                result["race_type"] = parts[3]
            if len(parts) >= 5:
                result["advertiser_name"] = parts[4]
        else:
            # Unknown structure — treat category as race_type
            result["office_type"] = category
            if len(parts) >= 4:
                result["advertiser_name"] = parts[3]

    return result


class FCCClient:
    """Async client for the FCC Public File API."""

    def __init__(self, timeout: float = 30.0):
        self._client = httpx.AsyncClient(
            base_url=FCC_BASE,
            timeout=timeout,
            headers={"Accept": "application/json"},
        )

    async def close(self):
        await self._client.aclose()

    async def __aenter__(self):
        return self

    async def __aexit__(self, *args):
        await self.close()

    async def search_station(self, call_sign: str) -> Optional[dict]:
        """
        Look up a station by call sign, return facility info including entity ID.
        Caches results in memory.
        """
        # Strip trailing -TV/-FM/-AM etc. for FCC search
        import re
        clean = re.sub(r'-(TV|FM|AM|DT|LP|CA|CD)$', '', call_sign.upper()).strip()

        if call_sign in _station_cache:
            return {"call_sign": call_sign, "entity_id": _station_cache[call_sign]}

        try:
            resp = await self._client.get(
                f"/service/tv/facility/search/{clean}"
            )
            resp.raise_for_status()
            data = resp.json()

            # FCC response structure: {results: {searchList: [{facility: null, facilityList: [...]}]}}
            facilities = []
            if isinstance(data, dict):
                search_results = data.get("results", {})
                if isinstance(search_results, dict):
                    search_list = search_results.get("searchList", [])
                    for entry in search_list:
                        fl = entry.get("facilityList", [])
                        facilities.extend(fl)
                elif isinstance(search_results, list):
                    facilities = search_results
            elif isinstance(data, list):
                facilities = data

            for item in facilities:
                entity_id = str(item.get("id", ""))
                if entity_id:
                    _station_cache[call_sign] = entity_id
                    logger.info(f"FCC station lookup: {call_sign} → entity {entity_id}")
                    return {
                        "call_sign": call_sign,
                        "entity_id": entity_id,
                        "network": item.get("networkAfil"),
                        "dma": item.get("nielsenDma"),
                        "community_city": item.get("communityCity"),
                        "community_state": item.get("communityState"),
                    }

            logger.warning(f"FCC station not found: {call_sign}")
            return None

        except httpx.HTTPStatusError as e:
            logger.error(f"FCC station search HTTP error for {call_sign}: {e.response.status_code}")
            return None
        except Exception as e:
            logger.error(f"FCC station search error for {call_sign}: {e}")
            return None

    async def get_political_filings(
        self, entity_id: str, limit: int = 100
    ) -> list[dict]:
        """
        Query political filings for a station entity.
        Returns list of filing metadata dicts.
        """
        try:
            resp = await self._client.get(
                "/manager/search/key/Political File.json",
                params={"entityId": entity_id, "limit": limit},
            )
            resp.raise_for_status()
            data = resp.json()

            # FCC response: {searchResult: {files: [...]}}
            files = []
            if isinstance(data, dict):
                sr = data.get("searchResult", {})
                if isinstance(sr, dict):
                    files = sr.get("files", [])
                elif isinstance(sr, list):
                    files = sr
            elif isinstance(data, list):
                files = data

            filings = []
            for item in files:
                filing = {
                    "file_id": item.get("file_id"),
                    "file_manager_id": item.get("file_manager_id"),
                    "folder_id": item.get("folder_id"),
                    "file_name": item.get("file_name"),
                    "file_folder_path": item.get("file_folder_path", ""),
                    "file_size": item.get("file_size"),
                    "file_extension": item.get("file_extension"),
                    "create_ts": item.get("create_ts"),
                    "last_update_ts": item.get("last_update_ts"),
                    "entity_id": entity_id,
                }

                # Parse the folder path for metadata
                path_meta = parse_folder_path(filing["file_folder_path"])
                filing.update(path_meta)

                filings.append(filing)

            logger.info(f"FCC filings for entity {entity_id}: {len(filings)} found")
            return filings

        except httpx.HTTPStatusError as e:
            logger.error(f"FCC filings HTTP error for entity {entity_id}: {e.response.status_code}")
            return []
        except Exception as e:
            logger.error(f"FCC filings error for entity {entity_id}: {e}")
            return []

    async def download_filing_pdf(
        self, folder_id: str, file_manager_id: str
    ) -> Optional[bytes]:
        """Download a filing PDF from the FCC."""
        try:
            resp = await self._client.get(
                f"/manager/download/{folder_id}/{file_manager_id}.pdf",
                timeout=60.0,
                follow_redirects=True,
            )
            resp.raise_for_status()

            if len(resp.content) < 100:
                logger.warning(f"FCC PDF too small ({len(resp.content)} bytes), likely an error page")
                return None

            logger.info(f"FCC PDF downloaded: {folder_id}/{file_manager_id} ({len(resp.content)} bytes)")
            return resp.content

        except httpx.HTTPStatusError as e:
            logger.error(f"FCC PDF download HTTP error: {e.response.status_code}")
            return None
        except Exception as e:
            logger.error(f"FCC PDF download error: {e}")
            return None


def parse_fcc_timestamp(ts_str: str) -> Optional[datetime]:
    """
    Parse FCC timestamps like '2026-04-03T12:24:48-04:00' into UTC datetime.
    """
    if not ts_str:
        return None
    try:
        dt = datetime.fromisoformat(ts_str)
        return dt.astimezone(timezone.utc)
    except (ValueError, TypeError):
        logger.warning(f"Could not parse FCC timestamp: {ts_str}")
        return None
