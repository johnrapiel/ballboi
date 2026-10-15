"""
HVT Shot Analysis ML Service
FastAPI server exposing video analysis endpoints.
"""
import os
import sys
import json
import tempfile
import logging
import urllib.request
import base64
from pathlib import Path

from fastapi import FastAPI, HTTPException, BackgroundTasks, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
logger = logging.getLogger(__name__)

app = FastAPI(title="HVT Shot Analysis ML Service", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

_ML_SECRET = os.environ.get("ML_SECRET")


async def require_ml_secret(x_ml_secret: str | None = Header(default=None)):
    if not _ML_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden: ML_SECRET not configured on server")
    if x_ml_secret != _ML_SECRET:
        raise HTTPException(status_code=403, detail="Forbidden")


class AnalyzeRequest(BaseModel):
    video_url: str
    recording_id: int
    callback_url: str


class AnalyzeResponse(BaseModel):
    recording_id: int
    status: str
    result: dict | None = None
    error: str | None = None


class LiveMatchRequest(BaseModel):
    session_id: int
    timestamp_seconds: float = 0
    frame_image: str | None = None
    court_calibration: dict | None = None


class BatchMatchRequest(BaseModel):
    video_url: str
    session_id: int
    match_id: int
    callback_url: str
    court_calibration: dict | None = None


class BatchMatchResponse(BaseModel):
    session_id: int
    status: str
    result: dict | None = None
    error: str | None = None


class DetectCourtRequest(BaseModel):
    frame_image: str  # base64-encoded JPEG (data URL or raw base64)


class DetectCourtResponse(BaseModel):
    success: bool
    corners: list[dict] | None = None   # [{x, y}, ...] normalized 0-1, in calibration order
    confidence: float | None = None
    lines_detected: int | None = None
    error: str | None = None


def download_video(url: str) -> str:
    """Download video to a temp file and return path."""
    suffix = ".mp4"
    if ".mov" in url.lower():
        suffix = ".mov"
    elif ".webm" in url.lower():
        suffix = ".webm"

    tmp = tempfile.NamedTemporaryFile(delete=False, suffix=suffix)
    tmp.close()

    logger.info(f"Downloading video from {url[:80]}...")
    secret = os.environ.get("ML_SECRET")
    headers = {"User-Agent": "HVT-ML/1.0"}
    if secret:
        headers["X-ML-Secret"] = secret
    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=120) as resp:
        with open(tmp.name, "wb") as f:
            f.write(resp.read())

    size_mb = os.path.getsize(tmp.name) / 1024 / 1024
    logger.info(f"Downloaded {size_mb:.1f} MB to {tmp.name}")
    return tmp.name


def process_and_callback(video_url: str, recording_id: int, callback_url: str):
    """Full pipeline: download video → analyze → POST results to callback."""
    import urllib.request as req_lib
    from services.analyzer import analyze_video

    video_path = None
    try:
        video_path = download_video(video_url)
        result = analyze_video(video_path)
        payload = {
            "recordingId": recording_id,
            "status": "completed",
            "result": result,
        }
    except Exception as e:
        logger.error(f"Analysis error for recording {recording_id}: {e}", exc_info=True)
        payload = {
            "recordingId": recording_id,
            "status": "failed",
            "error": str(e),
        }
    finally:
        if video_path and os.path.exists(video_path):
            os.unlink(video_path)

    # POST results back to Node.js API
    try:
        data = json.dumps(payload).encode()
        cb_req = req_lib.Request(
            callback_url,
            data=data,
            headers={"Content-Type": "application/json", **({"X-ML-Secret": os.environ["ML_SECRET"]} if os.environ.get("ML_SECRET") else {})},
            method="POST",
        )
        with req_lib.urlopen(cb_req, timeout=30) as resp:
            logger.info(f"Callback response: {resp.status}")
    except Exception as e:
        logger.error(f"Callback failed: {e}")


def process_match_and_callback(video_url: str, session_id: int, match_id: int, callback_url: str, court_calibration: dict | None = None):
    import urllib.request as req_lib
    from services.analyzer import analyze_video

    video_path = None
    try:
        video_path = download_video(video_url)
        from services.analyzer import analyze_match_video
        result = analyze_match_video(video_path, court_calibration)
        result["sessionId"] = session_id
        result["matchId"] = match_id
        payload = {
            "sessionId": session_id,
            "matchId": match_id,
            "status": "completed",
            "result": result,
        }
    except Exception as e:
        logger.error(f"Ball Boi analysis error for session {session_id}: {e}", exc_info=True)
        payload = {
            "sessionId": session_id,
            "matchId": match_id,
            "status": "failed",
            "error": str(e),
        }
    finally:
        if video_path and os.path.exists(video_path):
            os.unlink(video_path)

    try:
        data = json.dumps(payload).encode()
        cb_req = req_lib.Request(
            callback_url,
            data=data,
            headers={"Content-Type": "application/json", **({"X-ML-Secret": os.environ["ML_SECRET"]} if os.environ.get("ML_SECRET") else {})},
            method="POST",
        )
        with req_lib.urlopen(cb_req, timeout=30) as resp:
            logger.info(f"Ball Boi callback response: {resp.status}")
    except Exception as e:
        logger.error(f"Ball Boi callback failed: {e}")


@app.get("/health")
@app.get("/ml/health")
async def health():
    return {"status": "ok", "service": "hvt-ml-server"}


@app.post("/analyze", response_model=AnalyzeResponse, dependencies=[Depends(require_ml_secret)])
async def analyze(request: AnalyzeRequest, background_tasks: BackgroundTasks):
    """
    Accept a video URL, start analysis in background, and immediately return 202.
    Results are POSTed to callback_url when done.
    """
    logger.info(f"Received analysis request for recording_id={request.recording_id}")
    background_tasks.add_task(
        process_and_callback,
        request.video_url,
        request.recording_id,
        request.callback_url,
    )
    return AnalyzeResponse(
        recording_id=request.recording_id,
        status="processing",
    )


@app.post("/analyze-sync", response_model=AnalyzeResponse, dependencies=[Depends(require_ml_secret)])
async def analyze_sync(request: AnalyzeRequest):
    """
    Synchronous analysis (for testing). Blocks until complete.
    Not recommended for production use.
    """
    from services.analyzer import analyze_video

    video_path = None
    try:
        video_path = download_video(request.video_url)
        result = analyze_video(video_path)
        return AnalyzeResponse(recording_id=request.recording_id, status="completed", result=result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if video_path and os.path.exists(video_path):
            os.unlink(video_path)


@app.post("/analyze-match-live", dependencies=[Depends(require_ml_secret)])
async def analyze_match_live(request: LiveMatchRequest):
    if not request.frame_image:
        return {"sessionId": request.session_id, "status": "no_detection", "result": None}
    from services.analyzer import analyze_live_frame
    result = analyze_live_frame(request.frame_image, request.timestamp_seconds, request.court_calibration)
    if not result:
        return {"sessionId": request.session_id, "status": "no_detection", "result": None}
    return {
        "sessionId": request.session_id,
        "status": "completed",
        "result": result,
    }


@app.post("/detect-court-lines", response_model=DetectCourtResponse, dependencies=[Depends(require_ml_secret)])
async def detect_court_lines(request: DetectCourtRequest):
    """
    Detect tennis court boundary corners from a single video frame.
    Returns 4 corners in calibration order:
      near-left, near-right, far-right, far-left  (normalized 0-1).
    """
    from services.analyzer import detect_court_lines_from_frame
    result = detect_court_lines_from_frame(request.frame_image)
    return DetectCourtResponse(
        success=result.get("success", False),
        corners=result.get("corners"),
        confidence=result.get("confidence"),
        lines_detected=result.get("linesDetected"),
        error=result.get("error"),
    )


@app.post("/analyze-match-batch", response_model=BatchMatchResponse, dependencies=[Depends(require_ml_secret)])
async def analyze_match_batch(request: BatchMatchRequest, background_tasks: BackgroundTasks):
    logger.info(f"Received Ball Boi batch request for session_id={request.session_id}")
    background_tasks.add_task(
        process_match_and_callback,
        request.video_url,
        request.session_id,
        request.match_id,
        request.callback_url,
        request.court_calibration,
    )
    return BatchMatchResponse(session_id=request.session_id, status="processing")


if __name__ == "__main__":
    import uvicorn
    port = int(os.environ.get("PORT", 8000))
    uvicorn.run("main:app", host="0.0.0.0", port=port, reload=False)
