"""
Label and prediction files for the Ball Boi test set.

One JSON file per match. Labels are written by the labeling tool; predictions
are written by the pipeline. Both share the same shot shape so the eval can
compare them field by field.

Label file (schemaVersion 1):
{
  "schemaVersion": 1,
  "matchId": "2026-11-02-bubble-night",
  "video": {"file": "2026-11-02-bubble-night.mp4", "r2Key": "test-set/...mp4",
            "fps": 30.0, "width": 1920, "height": 1080, "durationSeconds": 3600.0},
  "conditions": {"venue": "indoor bubble", "surface": "hard", "lighting": "night", "level": "3.5"},
  "labeler": "John",
  "status": "in_progress" | "done",
  "calibrations": [{"fromTime": 0.0, "corners": [[x, y], ...4 normalized, near-left first]}],
  "shots": [Shot, ...]
}

Shot:
{
  "id": "s0001",
  "time": 12.345,                      # contact, seconds from the start of the video
  "hitter": "near" | "far",            # side of the net the hitter was on
  "type": "serve" | "forehand" | "backhand" | "volley" | "overhead",
  "serveNumber": 1 | 2 | null,         # serves only
  "bounce": {"time": 13.1, "image": [x, y], "court": [x_m, y_m]} | null,
  "result": "in" | "out" | "net" | "none",   # none: hit before it bounced, or never seen landing
  "closeCall": false,
  "pointEnd": null | "winner" | "forced_error" | "unforced_error"
}

Predictions add optional confidences ("typeConfidence", "resultConfidence")
and a "model" block naming the pipeline version that made them.
"""
from __future__ import annotations

import json
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

SCHEMA_VERSION = 1
SIDES = ("near", "far")
SHOT_TYPES = ("serve", "forehand", "backhand", "volley", "overhead")
RESULTS = ("in", "out", "net", "none")
POINT_ENDS = ("winner", "forced_error", "unforced_error")


class LabelError(ValueError):
    """A label or prediction file doesn't match the format. Message says where."""


@dataclass
class Bounce:
    time: float | None
    court: tuple[float, float] | None
    image: tuple[float, float] | None = None


@dataclass
class Shot:
    id: str
    time: float
    hitter: str
    type: str
    result: str
    serve_number: int | None = None
    bounce: Bounce | None = None
    close_call: bool = False
    point_end: str | None = None
    type_confidence: float | None = None
    result_confidence: float | None = None

    @property
    def is_serve(self) -> bool:
        return self.type == "serve"


@dataclass
class MatchFile:
    match_id: str
    shots: list[Shot]
    conditions: dict[str, str] = field(default_factory=dict)
    video: dict[str, Any] = field(default_factory=dict)
    status: str = "done"
    model: dict[str, Any] = field(default_factory=dict)
    path: Path | None = None


def _req(obj: dict, key: str, where: str) -> Any:
    if key not in obj:
        raise LabelError(f"{where}: missing '{key}'")
    return obj[key]


def _pair(value: Any, where: str) -> tuple[float, float] | None:
    if value is None:
        return None
    if (not isinstance(value, (list, tuple)) or len(value) != 2
            or not all(isinstance(v, (int, float)) for v in value)):
        raise LabelError(f"{where}: expected [x, y]")
    return float(value[0]), float(value[1])


def parse_shot(raw: dict, where: str) -> Shot:
    if not isinstance(raw, dict):
        raise LabelError(f"{where}: expected an object")
    hitter = _req(raw, "hitter", where)
    if hitter not in SIDES:
        raise LabelError(f"{where}: hitter must be one of {SIDES}, got {hitter!r}")
    shot_type = _req(raw, "type", where)
    if shot_type not in SHOT_TYPES:
        raise LabelError(f"{where}: type must be one of {SHOT_TYPES}, got {shot_type!r}")
    result = raw.get("result", "none")
    if result not in RESULTS:
        raise LabelError(f"{where}: result must be one of {RESULTS}, got {result!r}")
    point_end = raw.get("pointEnd")
    if point_end is not None and point_end not in POINT_ENDS:
        raise LabelError(f"{where}: pointEnd must be null or one of {POINT_ENDS}, got {point_end!r}")
    serve_number = raw.get("serveNumber")
    if serve_number not in (None, 1, 2):
        raise LabelError(f"{where}: serveNumber must be 1, 2, or null")
    time = _req(raw, "time", where)
    if not isinstance(time, (int, float)) or time < 0:
        raise LabelError(f"{where}: time must be seconds >= 0")

    bounce = None
    raw_bounce = raw.get("bounce")
    if raw_bounce is not None:
        if not isinstance(raw_bounce, dict):
            raise LabelError(f"{where}.bounce: expected an object or null")
        bounce = Bounce(
            time=float(raw_bounce["time"]) if isinstance(raw_bounce.get("time"), (int, float)) else None,
            court=_pair(raw_bounce.get("court"), f"{where}.bounce.court"),
            image=_pair(raw_bounce.get("image"), f"{where}.bounce.image"),
        )
    if result in ("in", "out") and (bounce is None or bounce.court is None):
        # Allowed (the bounce can be off-screen), but placement stats skip it.
        pass

    return Shot(
        id=str(raw.get("id", where)),
        time=float(time),
        hitter=hitter,
        type=shot_type,
        result=result,
        serve_number=serve_number if shot_type == "serve" else None,
        bounce=bounce,
        close_call=bool(raw.get("closeCall", False)),
        point_end=point_end,
        type_confidence=raw.get("typeConfidence"),
        result_confidence=raw.get("resultConfidence"),
    )


def parse_match(raw: dict, where: str = "file") -> MatchFile:
    if not isinstance(raw, dict):
        raise LabelError(f"{where}: expected a JSON object")
    version = raw.get("schemaVersion", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise LabelError(f"{where}: schemaVersion {version} isn't supported (expected {SCHEMA_VERSION})")
    match_id = _req(raw, "matchId", where)
    raw_shots = raw.get("shots", [])
    if not isinstance(raw_shots, list):
        raise LabelError(f"{where}: 'shots' must be a list")
    shots = [parse_shot(s, f"{where} shot {i + 1}") for i, s in enumerate(raw_shots)]
    shots.sort(key=lambda s: s.time)
    conditions = raw.get("conditions") or {}
    return MatchFile(
        match_id=str(match_id),
        shots=shots,
        conditions={str(k): str(v) for k, v in conditions.items() if v not in (None, "")},
        video=raw.get("video") or {},
        status=raw.get("status", "done"),
        model=raw.get("model") or {},
    )


def load_match(path: str | Path) -> MatchFile:
    p = Path(path)
    try:
        raw = json.loads(p.read_text())
    except json.JSONDecodeError as exc:
        raise LabelError(f"{p.name}: not valid JSON ({exc})") from exc
    match = parse_match(raw, p.name)
    match.path = p
    return match


def load_dir(directory: str | Path) -> dict[str, MatchFile]:
    """All match files in a folder, keyed by matchId. Files starting with '_' are skipped."""
    out: dict[str, MatchFile] = {}
    for p in sorted(Path(directory).glob("*.json")):
        if p.name.startswith("_"):
            continue
        m = load_match(p)
        if m.match_id in out:
            raise LabelError(f"{p.name}: matchId {m.match_id!r} is also used by {out[m.match_id].path.name}")
        out[m.match_id] = m
    return out


# ─── Points ──────────────────────────────────────────────────────────────────

@dataclass
class Point:
    shots: list[Shot]

    @property
    def ending(self) -> str | None:
        return self.shots[-1].point_end if self.shots else None

    @property
    def end_time(self) -> float:
        return self.shots[-1].time

    @property
    def rally_length(self) -> int:
        """Shots in the point, counting the serve that started it but not earlier faults."""
        n = 0
        for s in self.shots:
            if s.is_serve:
                n = 1
            else:
                n += 1
        return n

    @property
    def first_serve_in(self) -> bool | None:
        serves = [s for s in self.shots if s.is_serve]
        if not serves:
            return None
        first = serves[0]
        if first.serve_number == 2:
            return None  # first serve not recorded
        if first.result == "in":
            return True
        if first.result in ("out", "net"):
            return False
        return None  # landing not seen


def split_points(shots: list[Shot]) -> list[Point]:
    """Group shots into points. A point ends at the shot carrying pointEnd."""
    points: list[Point] = []
    current: list[Shot] = []
    for s in sorted(shots, key=lambda s: s.time):
        current.append(s)
        if s.point_end:
            points.append(Point(current))
            current = []
    return points
