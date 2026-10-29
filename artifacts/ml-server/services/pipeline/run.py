"""
Full match analysis: video in, shots and points out.

    result = analyze_match("match.mp4", calibration=phone_corners)

Steps:
  1. Court: the phone's four corners, or detected from the video.
  2. Ball: detector on every frame, then tracking.
  3. Kinks in the ball's path; people and pose only at those frames (CPU budget).
  4. Hits and bounces, then shot type, in or out, points.
"""
from __future__ import annotations

import logging
import time
from typing import Callable

from services.pipeline import ball as ball_mod
from services.pipeline.court import detect_court_in_video, from_phone
from services.pipeline.events import candidate_frames, find_events
from services.pipeline.models import Models, load_models
from services.pipeline.players import Players, assign_players
from services.pipeline.shots import build_shots, to_dict
from services.pipeline.video import iter_frames, read_frames, video_info

log = logging.getLogger(__name__)


class AnalysisError(RuntimeError):
    """A problem with the video itself, worded for the player."""


def analyze_match(video_path: str, calibration=None, models: Models | None = None,
                  progress: Callable[[str], None] | None = None) -> dict:
    started = time.time()
    say = progress or (lambda msg: log.info(msg))
    models = models or load_models()
    info = video_info(video_path)
    if info.frame_count < 3:
        raise AnalysisError("The recording is too short to analyze.")
    frame_shape = (info.height, info.width)

    say("Finding the court")
    court = from_phone(calibration) or detect_court_in_video(video_path)
    if court is None:
        raise AnalysisError("Ball Boi couldn't find the court lines. Fix the court lines and try again.")
    image_to_court = court.image_to_court

    say("Tracking the ball")
    candidates = ball_mod.run_detector(models.ball, iter_frames(video_path), info.frame_count)
    track = ball_mod.track_ball(candidates, info.width)

    players_at: dict[int, Players] = {}
    if models.people is not None:
        say("Finding players at each hit")
        frames = read_frames(video_path, candidate_frames(track, info.fps, info.height))
        for idx, frame in frames.items():
            players_at[idx] = assign_players(models.people(frame), image_to_court, frame_shape)

    say("Reading shots")
    hits = find_events(track, info.fps, frame_shape, image_to_court, players_at or None)
    shots = build_shots(hits, players_at, track.xy, info.fps, image_to_court, frame_shape)
    shot_dicts = [to_dict(s, i) for i, s in enumerate(shots)]

    points = []
    current: list[dict] = []
    for sd in shot_dicts:
        current.append(sd)
        if sd["pointEnd"]:
            serve_index = max((i for i, s in enumerate(current) if s["type"] == "serve"), default=0)
            points.append({
                "shots": [s["id"] for s in current],
                "ending": sd["pointEnd"],
                "rallyLength": len(current) - serve_index,
                "endedBy": sd["hitter"],
            })
            current = []

    seen = track.visible()
    return {
        "durationSeconds": round(info.duration, 2),
        "totalFrames": info.frame_count,
        "processingTimeMs": int((time.time() - started) * 1000),
        "model": models.describe(),
        "court": {"corners": court.corners, "source": court.source, "confidence": court.confidence},
        "shots": shot_dicts,
        "points": points,
        "metadata": {
            "fps": info.fps,
            "width": info.width,
            "height": info.height,
            "ballVisibleShare": round(float(seen.mean()), 3) if len(seen) else 0.0,
            "framesWithPlayers": len(players_at),
        },
    }


def to_prediction_file(result: dict, match_id: str) -> dict:
    """The eval harness's prediction format."""
    return {"schemaVersion": 1, "matchId": match_id, "model": result.get("model", {}), "shots": result["shots"]}
