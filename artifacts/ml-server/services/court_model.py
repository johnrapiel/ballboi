"""
Tennis court geometry shared by the pipeline, the labeling tool, and the eval.

Coordinate system (meters, ITF dimensions):
  origin  = center of the net
  +x      = to the right as seen from the camera, which sits behind the near baseline
  +y      = toward the far baseline
  near half: y < 0   far half: y > 0

Image points are normalized: (0, 0) is the top-left of the frame, (1, 1) the
bottom-right. Calibration corners are the four singles-court corners in this
order: near-left, near-right, far-right, far-left (same order the phone uses).
"""
from __future__ import annotations

import math
from typing import Iterable, Literal, Sequence

import numpy as np

# ─── ITF dimensions (meters) ─────────────────────────────────────────────────
HALF_LENGTH = 11.885          # net to baseline
SINGLES_HALF_WIDTH = 4.115    # center to singles sideline
DOUBLES_HALF_WIDTH = 5.485    # center to doubles sideline
SERVICE_LINE = 6.40           # net to service line
CENTER_MARK = 0.10            # length of the center mark on each baseline

# Serve placement splits each service box into three equal lanes.
SERVE_LANE_WIDTH = SINGLES_HALF_WIDTH / 3.0

CALIBRATION_ORDER = ("near-left", "near-right", "far-right", "far-left")
SINGLES_CORNERS_M = np.array(
    [
        [-SINGLES_HALF_WIDTH, -HALF_LENGTH],
        [SINGLES_HALF_WIDTH, -HALF_LENGTH],
        [SINGLES_HALF_WIDTH, HALF_LENGTH],
        [-SINGLES_HALF_WIDTH, HALF_LENGTH],
    ],
    dtype=np.float64,
)

Side = Literal["near", "far"]
ServeZone = Literal[
    "deuce_wide", "deuce_body", "deuce_t", "ad_wide", "ad_body", "ad_t",
]
SERVE_ZONES: tuple[str, ...] = (
    "deuce_wide", "deuce_body", "deuce_t", "ad_t", "ad_body", "ad_wide",
)

# Line segments of the singles court plus service boxes, for drawing overlays
# and for the court-keypoint fitter. Each entry is ((x1, y1), (x2, y2)).
COURT_LINES_M: tuple[tuple[tuple[float, float], tuple[float, float]], ...] = (
    ((-SINGLES_HALF_WIDTH, -HALF_LENGTH), (SINGLES_HALF_WIDTH, -HALF_LENGTH)),   # near baseline
    ((-SINGLES_HALF_WIDTH, HALF_LENGTH), (SINGLES_HALF_WIDTH, HALF_LENGTH)),     # far baseline
    ((-SINGLES_HALF_WIDTH, -HALF_LENGTH), (-SINGLES_HALF_WIDTH, HALF_LENGTH)),   # left singles sideline
    ((SINGLES_HALF_WIDTH, -HALF_LENGTH), (SINGLES_HALF_WIDTH, HALF_LENGTH)),     # right singles sideline
    ((-SINGLES_HALF_WIDTH, -SERVICE_LINE), (SINGLES_HALF_WIDTH, -SERVICE_LINE)), # near service line
    ((-SINGLES_HALF_WIDTH, SERVICE_LINE), (SINGLES_HALF_WIDTH, SERVICE_LINE)),   # far service line
    ((0.0, -SERVICE_LINE), (0.0, SERVICE_LINE)),                                 # center service line
    ((-DOUBLES_HALF_WIDTH, 0.0), (DOUBLES_HALF_WIDTH, 0.0)),                     # net
)


# ─── Homography ──────────────────────────────────────────────────────────────

def homography(src: Sequence[Sequence[float]], dst: Sequence[Sequence[float]]) -> np.ndarray:
    """Least-squares homography (DLT) mapping src points to dst points (4 or more)."""
    src_a = np.asarray(src, dtype=np.float64)
    dst_a = np.asarray(dst, dtype=np.float64)
    if src_a.shape != dst_a.shape or src_a.shape[0] < 4 or src_a.shape[1] != 2:
        raise ValueError("homography needs at least 4 matching 2D points")
    rows = []
    for (x, y), (u, v) in zip(src_a, dst_a):
        rows.append([-x, -y, -1, 0, 0, 0, u * x, u * y, u])
        rows.append([0, 0, 0, -x, -y, -1, v * x, v * y, v])
    _, _, vt = np.linalg.svd(np.asarray(rows))
    h = vt[-1].reshape(3, 3)
    if abs(h[2, 2]) < 1e-12:
        raise ValueError("degenerate homography")
    return h / h[2, 2]


def apply_homography(h: np.ndarray, points: Iterable[Sequence[float]]) -> np.ndarray:
    pts = np.asarray(list(points), dtype=np.float64).reshape(-1, 2)
    ones = np.ones((pts.shape[0], 1))
    mapped = np.hstack([pts, ones]) @ h.T
    return mapped[:, :2] / mapped[:, 2:3]


def image_to_court_matrix(corners: Sequence[Sequence[float]]) -> np.ndarray:
    """Homography from normalized image coordinates to court meters."""
    if len(corners) != 4:
        raise ValueError("calibration needs 4 corners: " + ", ".join(CALIBRATION_ORDER))
    return homography(corners, SINGLES_CORNERS_M)


def image_to_court(corners: Sequence[Sequence[float]], point: Sequence[float]) -> tuple[float, float]:
    x, y = apply_homography(image_to_court_matrix(corners), [point])[0]
    return float(x), float(y)


def court_to_image(corners: Sequence[Sequence[float]], point: Sequence[float]) -> tuple[float, float]:
    h = np.linalg.inv(image_to_court_matrix(corners))
    x, y = apply_homography(h, [point])[0]
    return float(x), float(y)


# ─── Regions ─────────────────────────────────────────────────────────────────

def side_of(y: float) -> Side:
    return "far" if y > 0 else "near"


def other_side(side: Side) -> Side:
    return "far" if side == "near" else "near"


def _rect_signed_distance(x: float, y: float, x0: float, x1: float, y0: float, y1: float,
                          open_edge_y: float) -> float:
    """
    Signed distance from (x, y) to the rectangle's boundary, ignoring the edge at
    y == open_edge_y (the net, which never decides in or out).
    Positive inside, negative outside. Line widths count as in, as in the rules,
    so callers compare against 0.
    """
    lo_y, hi_y = min(y0, y1), max(y0, y1)
    inside = x0 <= x <= x1 and lo_y <= y <= hi_y
    edges = []
    # vertical edges (x = x0, x = x1) span the full y range
    for ex in (x0, x1):
        dy = 0.0 if lo_y <= y <= hi_y else min(abs(y - lo_y), abs(y - hi_y))
        edges.append(math.hypot(x - ex, dy))
    # horizontal edges except the net
    for ey in (y0, y1):
        if math.isclose(ey, open_edge_y):
            continue
        dx = 0.0 if x0 <= x <= x1 else min(abs(x - x0), abs(x - x1))
        edges.append(math.hypot(dx, y - ey))
    d = min(edges)
    return d if inside else -d


def rally_target_distance(x: float, y: float, hitter: Side) -> float:
    """Signed distance (m) to the singles court on the receiver's half. >= 0 means in."""
    if hitter == "near":
        return _rect_signed_distance(x, y, -SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH, 0.0, HALF_LENGTH, 0.0)
    return _rect_signed_distance(x, y, -SINGLES_HALF_WIDTH, SINGLES_HALF_WIDTH, -HALF_LENGTH, 0.0, 0.0)


def _service_boxes(receiver: Side) -> dict[str, tuple[float, float, float, float]]:
    """Service boxes on the receiver's half, keyed deuce/ad from the receiver's view."""
    sign = 1.0 if receiver == "far" else -1.0
    y0, y1 = 0.0, sign * SERVICE_LINE
    # A receiver at the far end faces the camera, so their right (deuce) is image-left.
    if receiver == "far":
        return {"deuce": (-SINGLES_HALF_WIDTH, 0.0, y0, y1), "ad": (0.0, SINGLES_HALF_WIDTH, y0, y1)}
    return {"deuce": (0.0, SINGLES_HALF_WIDTH, y0, y1), "ad": (-SINGLES_HALF_WIDTH, 0.0, y0, y1)}


def serve_target_distance(x: float, y: float, server: Side, box: str | None = None) -> tuple[str, float]:
    """
    Signed distance (m) to the target service box. If `box` isn't given, the box
    nearest the landing point on the receiver's half is used.
    Returns (box, distance); distance >= 0 means in.
    """
    boxes = _service_boxes(other_side(server))
    scored = {
        name: _rect_signed_distance(x, y, bx0, bx1, by0, by1, 0.0)
        for name, (bx0, bx1, by0, by1) in boxes.items()
    }
    if box is None:
        box = max(scored, key=lambda name: scored[name])
    return box, scored[box]


def serve_zone(x: float, y: float) -> str | None:
    """Wide / body / T lane of a serve that landed in a service box, from the receiver's view."""
    if abs(y) > SERVICE_LINE or abs(x) > SINGLES_HALF_WIDTH or y == 0:
        return None
    receiver: Side = "far" if y > 0 else "near"
    deuce = (x < 0) if receiver == "far" else (x > 0)
    box = "deuce" if deuce else "ad"
    ax = abs(x)
    if ax < SERVE_LANE_WIDTH:
        lane = "t"
    elif ax < 2 * SERVE_LANE_WIDTH:
        lane = "body"
    else:
        lane = "wide"
    return f"{box}_{lane}"


def line_call_distance(x: float, y: float, hitter: Side, is_serve: bool) -> float:
    """Signed distance to the line that decides this shot's in/out call."""
    if is_serve:
        return serve_target_distance(x, y, hitter)[1]
    return rally_target_distance(x, y, hitter)
