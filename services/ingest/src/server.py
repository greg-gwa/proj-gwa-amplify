import asyncio
import logging
from fastapi import FastAPI, Request, UploadFile
from fastapi.responses import JSONResponse
from src.ingest_email import handle_inbound_email
from src.ingest_clip import handle_clip
from src.fetch_attachments import fetch_mailgun_attachments
from src.scan_radar import scan
from src.db import get_pool, close_pool

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

app = FastAPI(title="Amplify Ingest", version="0.3.0")


@app.on_event("startup")
async def startup():
    await get_pool()
    logger.info("Database pool initialized")


@app.on_event("shutdown")
async def shutdown():
    await close_pool()
    logger.info("Database pool closed")


@app.get("/health")
async def health():
    pool = await get_pool()
    async with pool.acquire() as conn:
        await conn.fetchval("SELECT 1")
    return {"status": "ok"}


@app.post("/inbound")
async def inbound(request: Request):
    """Mailgun inbound webhook — receives email as form data."""
    try:
        form = await request.form()
        body = {}
        files = []

        for key in form:
            val = form[key]
            if isinstance(val, UploadFile):
                content = await val.read()
                if len(content) > 0:
                    files.append({
                        "filename": val.filename or key,
                        "content_type": val.content_type or "application/octet-stream",
                        "content": content,
                    })
                    logger.info(f"Attachment: {val.filename}, {val.content_type}, {len(content)} bytes")
            else:
                body[key] = str(val)

        attachment_count = int(body.get("attachment-count", "0"))
        logger.info(f"Inbound POST. subject={body.get('subject')}, "
                   f"parsed_files={len(files)}, mailgun_attachment_count={attachment_count}")

        # If Mailgun says there are attachments but we didn't parse any,
        # fetch them from Mailgun's stored message API
        if attachment_count > 0 and len(files) == 0:
            logger.info("Attachments missing from form data — fetching from Mailgun API")
            mg_files = await fetch_mailgun_attachments(body)
            files.extend(mg_files)
            logger.info(f"Fetched {len(mg_files)} attachments from Mailgun API")

        result = await handle_inbound_email(body, files)
        logger.info(f"Processed: {result['email_id']} → "
                   f"{result['show_count']} shows, {result['buy_count']} buys")
        return {"ok": True, **result}
    except Exception as e:
        logger.exception("Ingest error")
        return {"ok": False, "error": str(e)}


@app.post("/clip")
async def clip(request: Request):
    """Single ad clip: transcribe → extract → store."""
    try:
        body = await request.json()
        logger.info(f"Clip POST: {body.get('url')}")
        result = await handle_clip(body)
        return {"ok": True, **result}
    except Exception as e:
        logger.exception("Clip error")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.post("/scan")
async def scan_radar(request: Request):
    """FCC radar scan — queries FCC API for new political filings."""
    try:
        body = {}
        try:
            body = await request.json()
        except Exception:
            pass

        stations = body.get("stations")
        markets = body.get("markets")
        lookback_hours = body.get("lookback_hours")

        pool = await get_pool()
        async with pool.acquire() as conn:
            result = await scan(conn, stations=stations, markets=markets, lookback_hours=lookback_hours)

        return {"ok": True, **result}
    except Exception as e:
        logger.exception("Scan error")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})


@app.post("/clips")
async def clips_batch(request: Request):
    """Batch clip ingestion."""
    try:
        body = await request.json()
        clip_list = body.get("clips", [])
        logger.info(f"Batch clip POST: {len(clip_list)} clips")
        results = []
        for c in clip_list:
            try:
                result = await handle_clip(c)
                results.append({"ok": True, **result})
            except Exception as e:
                results.append({"ok": False, "url": c.get("url"), "error": str(e)})
        return {"ok": True, "processed": len(results), "results": results}
    except Exception as e:
        logger.exception("Batch clip error")
        return JSONResponse(status_code=500, content={"ok": False, "error": str(e)})
