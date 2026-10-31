"""
Ball Boi labeling tool: a local web page for labeling test-set matches.

Run it on your own computer only. It reads video from a local folder and
writes one label file per match, in the format the eval harness scores.

    python -m labeling --videos ~/BallBoiTestSet --labels evaluation/labels
"""
from __future__ import annotations

import json
import os
import re
import tempfile
from pathlib import Path
from typing import Any

from starlette.applications import Starlette
from starlette.requests import Request
from starlette.responses import FileResponse, JSONResponse, Response
from starlette.routing import Route

from evaluation.schema import SCHEMA_VERSION, LabelError, parse_match
from services import court_model

HERE = Path(__file__).resolve().parent
VIDEO_SUFFIXES = {".mp4", ".mov", ".m4v", ".webm"}
SAFE_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,120}$")


def match_id_for(video: Path) -> str:
    return video.stem


def video_metadata(path: Path) -> dict[str, Any]:
    """fps, size, and duration from the file. Falls back to 30 fps if OpenCV can't tell."""
    meta: dict[str, Any] = {"file": path.name, "fps": 30.0}
    try:
        import cv2

        cap = cv2.VideoCapture(str(path))
        if cap.isOpened():
            fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
            frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
            meta.update(
                fps=round(float(fps), 3),
                width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
                height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
                durationSeconds=round(frames / fps, 3) if frames else None,
            )
        cap.release()
    except Exception:  # metadata is a convenience, never a blocker
        pass
    return meta


def calibration_at(calibrations: list[dict], time: float) -> list | None:
    """Corners of the latest calibration that starts at or before `time`."""
    active = None
    for cal in sorted(calibrations, key=lambda c: c.get("fromTime", 0.0)):
        if cal.get("fromTime", 0.0) <= time + 1e-6:
            active = cal.get("corners")
    if active is None and calibrations:
        active = sorted(calibrations, key=lambda c: c.get("fromTime", 0.0))[0].get("corners")
    return active


def fill_court_positions(raw: dict) -> dict:
    """
    Recompute every bounce's court position from its image point and the
    calibration active at that moment, so stored labels always use the same
    geometry as the eval and the pipeline.
    """
    calibrations = [c for c in raw.get("calibrations", []) if len(c.get("corners") or []) == 4]
    for shot in raw.get("shots", []):
        bounce = shot.get("bounce")
        if not bounce or not bounce.get("image"):
            continue
        t = bounce.get("time", shot.get("time", 0.0)) or 0.0
        corners = calibration_at(calibrations, t)
        if corners is None:
            bounce["court"] = None
            continue
        x, y = court_model.image_to_court(corners, bounce["image"])
        bounce["court"] = [round(x, 3), round(y, 3)]
    return raw


def write_atomic(path: Path, data: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=".tmp-", suffix=".json")
    with os.fdopen(fd, "w") as f:
        json.dump(data, f, indent=2)
        f.write("\n")
    os.replace(tmp, path)


def create_app(videos_dir: Path, labels_dir: Path) -> Starlette:
    videos_dir = videos_dir.expanduser().resolve()
    labels_dir = labels_dir.expanduser().resolve()

    def find_video(match_id: str) -> Path | None:
        if not SAFE_ID.match(match_id):
            return None
        for suffix in VIDEO_SUFFIXES:
            for candidate in (videos_dir / f"{match_id}{suffix}", videos_dir / f"{match_id}{suffix.upper()}"):
                if candidate.is_file():
                    return candidate
        return None

    def label_path(match_id: str) -> Path:
        return labels_dir / f"{match_id}.json"

    async def index(request: Request) -> Response:
        return FileResponse(HERE / "static" / "index.html", media_type="text/html")

    async def list_videos(request: Request) -> Response:
        items = []
        if videos_dir.is_dir():
            for p in sorted(videos_dir.iterdir()):
                if p.suffix.lower() not in VIDEO_SUFFIXES or not SAFE_ID.match(p.stem):
                    continue
                entry = {"matchId": match_id_for(p), "file": p.name, "status": "not_started", "shots": 0}
                lp = label_path(p.stem)
                if lp.is_file():
                    try:
                        raw = json.loads(lp.read_text())
                        entry["status"] = raw.get("status", "in_progress")
                        entry["shots"] = len(raw.get("shots", []))
                    except json.JSONDecodeError:
                        entry["status"] = "unreadable"
                items.append(entry)
        return JSONResponse({"videosDir": str(videos_dir), "labelsDir": str(labels_dir), "videos": items})

    async def get_video(request: Request) -> Response:
        path = find_video(request.path_params["match_id"])
        if not path:
            return JSONResponse({"error": "video not found"}, status_code=404)
        return FileResponse(path)

    async def get_label(request: Request) -> Response:
        match_id = request.path_params["match_id"]
        video = find_video(match_id)
        if not video:
            return JSONResponse({"error": "video not found"}, status_code=404)
        lp = label_path(match_id)
        if lp.is_file():
            raw = json.loads(lp.read_text())
            raw["video"] = {**video_metadata(video), **(raw.get("video") or {})}
            return JSONResponse(raw)
        return JSONResponse({
            "schemaVersion": SCHEMA_VERSION,
            "matchId": match_id,
            "video": video_metadata(video),
            "conditions": {"venue": "", "surface": "", "lighting": "", "level": ""},
            "labeler": "",
            "status": "in_progress",
            "calibrations": [],
            "shots": [],
        })

    async def put_label(request: Request) -> Response:
        match_id = request.path_params["match_id"]
        if not find_video(match_id):
            return JSONResponse({"error": "video not found"}, status_code=404)
        try:
            raw = await request.json()
        except json.JSONDecodeError:
            return JSONResponse({"error": "not valid JSON"}, status_code=400)
        if not isinstance(raw, dict) or raw.get("matchId") != match_id:
            return JSONResponse({"error": "matchId doesn't match this video"}, status_code=400)
        raw["schemaVersion"] = SCHEMA_VERSION
        raw = fill_court_positions(raw)
        raw["shots"] = sorted(raw.get("shots", []), key=lambda s: s.get("time", 0))
        try:
            parse_match(raw, f"{match_id}.json")
        except LabelError as exc:
            return JSONResponse({"error": str(exc)}, status_code=422)
        write_atomic(label_path(match_id), raw)
        return JSONResponse({"ok": True, "shots": raw["shots"]})

    async def court_lines(request: Request) -> Response:
        return JSONResponse({
            "lines": court_model.COURT_LINES_M,
            "corners": court_model.SINGLES_CORNERS_M.tolist(),
            "order": court_model.CALIBRATION_ORDER,
            "closeCallMeters": 0.10,
        })

    return Starlette(routes=[
        Route("/", index),
        Route("/api/videos", list_videos),
        Route("/api/court", court_lines),
        Route("/api/labels/{match_id}", get_label, methods=["GET"]),
        Route("/api/labels/{match_id}", put_label, methods=["PUT"]),
        Route("/video/{match_id}", get_video),
    ])
