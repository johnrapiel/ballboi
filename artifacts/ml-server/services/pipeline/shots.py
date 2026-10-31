"""
Shot type, in or out, and how each point ended.

Shot type at contact, from the hitter's pose:
  serve      first hit of a rally
  overhead   racket wrist above the head (or the ball above the player's box)
  volley     no bounce since the opponent hit it
  forehand / backhand
             ball on the racket-hand side of the body or not. The near player
             faces away from the camera and the far player faces it, so the
             far player's sides are mirrored on screen. Racket hand comes from
             the last serve on that side (the hand above the head); right by default.

In or out comes from the bounce's court position and the line that decides it.
Every call carries an uncertainty: the bounce's on-screen precision projected to
the ground. A call within two of those (or 10 cm) of the line is flagged
"Close call" so the app never states a coin flip as fact.
"""
from __future__ import annotations

import math
from dataclasses import dataclass

import numpy as np

from services import court_model as cm
from services.pipeline.events import Hit
from services.pipeline.players import L_WRIST, NOSE, R_WRIST, Person, Players

CLOSE_CALL_MIN_METERS = 0.10
BOUNCE_PIXEL_ERROR = 2.0      # typical on-screen error of a detected bounce, in pixels


@dataclass
class ShotOut:
    hit: Hit
    time: float
    type: str
    type_confidence: float
    result: str
    result_confidence: float | None
    close_call: bool
    line_distance: float | None
    serve_number: int | None = None
    point_end: str | None = None
    speed_mph: float | None = None
    hitter_court: tuple[float, float] | None = None
    bounce_time: float | None = None
    contact: tuple[float, float] | None = None      # normalized ball position at contact


# ─── Shot type ───────────────────────────────────────────────────────────────

def _racket_hand_from_serve(person: Person | None) -> str | None:
    if person is None:
        return None
    lw, rw = person.point(L_WRIST), person.point(R_WRIST)
    if lw is None or rw is None:
        return None
    # The serving hand is the higher one at contact (smaller y on screen).
    if abs(lw[1] - rw[1]) < 0.05 * person.height_px:
        return None
    return "left" if lw[1] < rw[1] else "right"


def classify_type(hit: Hit, first_of_rally: bool, previous: ShotOut | None, person: Person | None,
                  ball_px: np.ndarray, racket_hand: str) -> tuple[str, float]:
    if first_of_rally:
        return "serve", 0.95
    if person is not None:
        nose = person.point(NOSE)
        wrists = [w for w in (person.point(L_WRIST), person.point(R_WRIST)) if w is not None]
        top = person.box[1]
        if (nose is not None and wrists and min(w[1] for w in wrists) < nose[1] - 0.08 * person.height_px) \
                or ball_px[1] < top - 0.15 * person.height_px:
            return "overhead", 0.75
    no_bounce = previous is not None and previous.hit.bounce_frame is None and previous.result != "net"
    if no_bounce:
        near_net = person is None or person.court is None or abs(person.court[1]) < cm.SERVICE_LINE + 1.0
        if near_net:
            return "volley", 0.8 if person is not None else 0.6
    if person is None:
        return "forehand", 0.5
    offset = float(ball_px[0] - person.center_x)
    # On screen, the near player's right is to the right; the far player's right is to the left.
    right_side = offset > 0 if hit.side == "near" else offset < 0
    forehand = right_side if racket_hand == "right" else not right_side
    margin = min(1.0, abs(offset) / max(1.0, 0.5 * (person.box[2] - person.box[0])))
    return ("forehand" if forehand else "backhand"), round(0.55 + 0.4 * margin, 3)


# ─── In or out ───────────────────────────────────────────────────────────────

def _meters_per_pixel(image_to_court: np.ndarray, norm_point: tuple[float, float], frame_shape) -> float:
    h, w = frame_shape
    base = cm.apply_homography(image_to_court, [norm_point])[0]
    dx = cm.apply_homography(image_to_court, [(norm_point[0] + 1 / w, norm_point[1])])[0]
    dy = cm.apply_homography(image_to_court, [(norm_point[0], norm_point[1] + 1 / h)])[0]
    return float(max(np.linalg.norm(dx - base), np.linalg.norm(dy - base)))


def call_line(hit: Hit, is_serve: bool, image_to_court: np.ndarray, frame_shape) -> tuple[str, float | None, bool, float | None]:
    """(result, confidence, close_call, signed distance to the deciding line)."""
    if hit.bounce_court is None:
        if hit.long_past_near_baseline:
            return "out", 0.7, False, None
        return "none", None, False, None
    if hit.landed_on_own_side:
        return "net", 0.8, False, None
    x, y = hit.bounce_court
    d = cm.line_call_distance(x, y, hit.side, is_serve)
    sigma = BOUNCE_PIXEL_ERROR * _meters_per_pixel(image_to_court, hit.bounce_image, frame_shape)
    confidence = 0.5 + 0.5 * math.erf(abs(d) / (max(sigma, 1e-3) * math.sqrt(2)))
    close = abs(d) < max(CLOSE_CALL_MIN_METERS, 2 * sigma)
    return ("in" if d >= 0 else "out"), round(confidence, 3), close, round(d, 3)


# ─── Points ──────────────────────────────────────────────────────────────────

def assign_points(shots: list[ShotOut]) -> None:
    """Serve numbers and point endings, rally by rally."""
    rallies: dict[int, list[ShotOut]] = {}
    for s in shots:
        rallies.setdefault(s.hit.rally, []).append(s)
    ordered = [rallies[k] for k in sorted(rallies)]
    speeds = sorted(s.speed_mph for s in shots if s.speed_mph)
    fast = speeds[int(0.75 * (len(speeds) - 1))] if speeds else math.inf

    previous_serve: ShotOut | None = None
    for rally in ordered:
        serve = rally[0]
        if serve.type == "serve":
            fault_before = (previous_serve is not None and previous_serve.hit.side == serve.hit.side
                            and previous_serve.serve_number == 1 and previous_serve.result in ("out", "net")
                            and previous_serve.point_end is None)
            serve.serve_number = 2 if fault_before else 1
            previous_serve = serve
        last = rally[-1]
        if last.type == "serve" and last.result in ("out", "net") and last.serve_number == 1:
            continue                                   # a fault: the point goes on
        if last.result == "in":
            last.point_end = "winner"
        elif last.result in ("out", "net"):
            before = rally[-2] if len(rally) > 1 else None
            pressured = before is not None and (
                (before.speed_mph or 0) >= fast
                or (before.line_distance is not None and 0 <= before.line_distance < 1.0)
            )
            last.point_end = "forced_error" if pressured else "unforced_error"
        else:
            last.point_end = None                      # landing unseen: no guess


# ─── Speed ───────────────────────────────────────────────────────────────────

def estimate_speed(hit: Hit, hitter_court: tuple[float, float] | None, fps: float) -> float | None:
    """Average ground speed from contact to bounce. A floor for serve speed, not radar."""
    if hit.bounce_court is None or hit.bounce_frame is None:
        return None
    start = hitter_court or (hit.bounce_court[0], -cm.HALF_LENGTH if hit.side == "near" else cm.HALF_LENGTH)
    seconds = (hit.bounce_frame - hit.frame) / fps
    if seconds <= 0:
        return None
    meters = math.dist(start, hit.bounce_court)
    return round(meters / seconds * 2.23694, 1)


def build_shots(hits: list[Hit], players_at: dict[int, Players], ball_xy: np.ndarray, fps: float,
                image_to_court: np.ndarray, frame_shape) -> list[ShotOut]:
    shots: list[ShotOut] = []
    racket_hand = {"near": "right", "far": "right"}
    faulted_rally = None
    for i, hit in enumerate(hits):
        first = i == 0 or hits[i - 1].rally != hit.rally
        if not first and hit.rally == faulted_rally:
            continue                     # receivers often knock a fault back; it isn't a shot
        players = players_at.get(hit.frame)
        person = players.side(hit.side) if players else None
        if first:
            hand = _racket_hand_from_serve(person)
            if hand:
                racket_hand[hit.side] = hand
        previous = shots[-1] if shots and not first and shots[-1].hit.rally == hit.rally else None
        shot_type, type_conf = classify_type(hit, first, previous, person, ball_xy[hit.frame], racket_hand[hit.side])
        result, result_conf, close, distance = call_line(hit, shot_type == "serve", image_to_court, frame_shape)
        hitter_court = person.court if person is not None else None
        if shot_type == "serve" and result in ("out", "net"):
            faulted_rally = hit.rally
        shots.append(ShotOut(
            hit=hit, time=round(hit.frame / fps, 3), type=shot_type, type_confidence=type_conf,
            result=result, result_confidence=result_conf, close_call=close, line_distance=distance,
            speed_mph=estimate_speed(hit, hitter_court, fps), hitter_court=hitter_court,
            bounce_time=round(hit.bounce_frame / fps, 3) if hit.bounce_frame is not None else None,
            contact=(round(float(ball_xy[hit.frame][0]) / frame_shape[1], 4),
                     round(float(ball_xy[hit.frame][1]) / frame_shape[0], 4)),
        ))
    assign_points(shots)
    return shots


# ─── Output ──────────────────────────────────────────────────────────────────

_LEGACY_OUTCOME = {"winner": "winner", "forced_error": "error", "unforced_error": "unforced_error"}


def _legacy_zone(shot: ShotOut) -> tuple[str, float, float]:
    if shot.hit.bounce_court is None:
        return "unknown", 0.5, 0.5
    x, y = shot.hit.bounce_court
    nx = min(1.0, max(0.0, (x + cm.SINGLES_HALF_WIDTH) / (2 * cm.SINGLES_HALF_WIDTH)))
    ny = min(1.0, max(0.0, (cm.HALF_LENGTH - y) / (2 * cm.HALF_LENGTH)))
    if shot.result == "net":
        name = "net"
    elif shot.result == "out":
        name = "out"
    elif shot.type == "serve":
        zone = cm.serve_zone(x, y)
        name = f"service_box_{zone.split('_')[0]}" if zone else "out"
    else:
        name = "baseline_left" if x < 0 else "baseline_right"
    return name, round(nx, 4), round(ny, 4)


def _depth(shot: ShotOut) -> str:
    if shot.hit.bounce_court is None:
        return "unknown"
    d = abs(shot.hit.bounce_court[1])
    return "net" if d < 3 else "service_line" if d < cm.SERVICE_LINE else "baseline" if d < 10 else "deep"


def to_dict(shot: ShotOut, index: int) -> dict:
    """Eval-format fields plus the legacy fields the API's shot callback reads."""
    hit = shot.hit
    zone_name, zx, zy = _legacy_zone(shot)
    bounce = None
    if hit.bounce_court is not None:
        bounce = {
            "time": shot.bounce_time,
            "image": [round(hit.bounce_image[0], 4), round(hit.bounce_image[1], 4)],
            "court": [round(hit.bounce_court[0], 3), round(hit.bounce_court[1], 3)],
        }
    return {
        "id": f"p{index + 1:04d}",
        "time": shot.time,
        "hitter": hit.side,
        "type": shot.type,
        "typeConfidence": shot.type_confidence,
        "serveNumber": shot.serve_number,
        "bounce": bounce,
        "result": shot.result,
        "resultConfidence": shot.result_confidence,
        "closeCall": shot.close_call,
        "lineDistanceMeters": shot.line_distance,
        "pointEnd": shot.point_end,
        "serveZone": cm.serve_zone(*hit.bounce_court) if shot.type == "serve" and shot.result == "in" else None,
        # Legacy fields (api-server buildShotFromResult)
        "sequenceNumber": index + 1,
        "rallyNumber": hit.rally + 1,
        "timestampSeconds": shot.time,
        "shotType": shot.type,
        "shotTypeConfidence": shot.type_confidence,
        "outcome": _LEGACY_OUTCOME.get(shot.point_end or "", "rally_continuation"),
        "outcomeConfidence": shot.result_confidence or 0.5,
        "courtZone": {"name": zone_name, "x": zx, "y": zy},
        "contactPoint": {"x": shot.contact[0] if shot.contact else 0.5,
                         "y": shot.contact[1] if shot.contact else 0.5, "frameNumber": hit.frame},
        "ballTrajectory": {"estimatedSpeedMph": shot.speed_mph, "spin": "unknown", "depth": _depth(shot), "angle": 0.0},
        "playerPose": {"stance": "unknown"},
        "rawMlData": {"bounceFrame": hit.bounce_frame, **hit.evidence},
    }
