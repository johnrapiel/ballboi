"""
Court keypoints: where the court is in the video.

The phone does court detection on device and sends the four singles corners
(the spec's "court-line fix" lets players correct them). Those always win.
When they're missing, this module finds the court itself: it picks out the
painted lines, then searches for the camera view of a regulation court that
best explains them (a model-fitting method in the style of Farin et al.,
"Robust camera calibration for sport videos using court models", 2004).

No third-party weights: the widely used tennis keypoint model has no license,
so it can't ship in a commercial app. The labeled test set lets us train our
own keypoint model later if this falls short.
"""
from __future__ import annotations

import itertools
from dataclasses import dataclass

import cv2
import numpy as np

from services import court_model as cm

# Lines a camera behind the baseline can see. Horizontal ones run across the court.
_ACROSS = (cm.HALF_LENGTH, cm.SERVICE_LINE, -cm.SERVICE_LINE, -cm.HALF_LENGTH)      # far to near
_ALONG = (-cm.DOUBLES_HALF_WIDTH, -cm.SINGLES_HALF_WIDTH, 0.0, cm.SINGLES_HALF_WIDTH, cm.DOUBLES_HALF_WIDTH)

# Every painted line used to score a candidate view.
_SCORE_LINES = cm.COURT_LINES_M[:-1] + (
    ((-cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH), (-cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH)),
    ((cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH), (cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH)),
    ((-cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH), (cm.DOUBLES_HALF_WIDTH, -cm.HALF_LENGTH)),
    ((-cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH), (cm.DOUBLES_HALF_WIDTH, cm.HALF_LENGTH)),
)


@dataclass
class CourtFit:
    corners: list[list[float]]   # normalized singles corners, calibration order
    confidence: float            # share of model line samples that land on painted lines
    source: str                  # "phone" or "detected"

    @property
    def image_to_court(self) -> np.ndarray:
        return cm.image_to_court_matrix(self.corners)


def line_mask(frame: np.ndarray) -> np.ndarray:
    """Thin bright marks: court paint, not sky or white clothing blobs."""
    gray = cv2.cvtColor(frame, cv2.COLOR_BGR2GRAY)
    h, w = gray.shape
    k = max(5, int(round(min(h, w) / 60)) | 1)
    tophat = cv2.morphologyEx(gray, cv2.MORPH_TOPHAT, cv2.getStructuringElement(cv2.MORPH_RECT, (k, k)))
    hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
    low_sat = hsv[..., 1] < 90
    mask = ((tophat > 35) & low_sat & (gray > 120)).astype(np.uint8) * 255
    return mask


def _hough_lines(mask: np.ndarray) -> list[tuple[float, float, float]]:
    """Long straight lines as (rho, theta, votes), merged so each painted line appears once."""
    h, w = mask.shape
    segs = cv2.HoughLinesP(mask, 1, np.pi / 360, threshold=40,
                           minLineLength=min(h, w) * 0.12, maxLineGap=min(h, w) * 0.03)
    if segs is None:
        return []
    lines: list[list[float]] = []
    for x1, y1, x2, y2 in segs.reshape(-1, 4):          # OpenCV 4 gives (N, 1, 4), OpenCV 5 (N, 4)
        theta = np.arctan2(x2 - x1, -(y2 - y1))           # normal angle
        if theta < 0:
            theta += np.pi
        rho = x1 * np.cos(theta) + y1 * np.sin(theta)
        length = float(np.hypot(x2 - x1, y2 - y1))
        for line in lines:
            if abs(line[1] - theta) < np.deg2rad(2.5) and abs(line[0] - rho) < max(h, w) * 0.012:
                total = line[2] + length
                line[0] = (line[0] * line[2] + rho * length) / total
                line[1] = (line[1] * line[2] + theta * length) / total
                line[2] = total
                break
        else:
            lines.append([float(rho), float(theta), length])
    lines.sort(key=lambda l: -l[2])
    return [tuple(l) for l in lines]


def _intersect(a: tuple, b: tuple) -> tuple[float, float] | None:
    r1, t1 = a[0], a[1]
    r2, t2 = b[0], b[1]
    m = np.array([[np.cos(t1), np.sin(t1)], [np.cos(t2), np.sin(t2)]])
    if abs(np.linalg.det(m)) < 1e-6:
        return None
    x, y = np.linalg.solve(m, [r1, r2])
    return float(x), float(y)


def _samples(h_court_to_img: np.ndarray, shape: tuple[int, int], per_line: int = 40):
    pts = []
    for (x1, y1), (x2, y2) in _SCORE_LINES:
        t = np.linspace(0, 1, per_line)
        pts.append(np.stack([x1 + (x2 - x1) * t, y1 + (y2 - y1) * t], axis=1))
    court_pts = np.concatenate(pts)
    img = cm.apply_homography(h_court_to_img, court_pts)
    h, w = shape
    inside = (img[:, 0] >= 0) & (img[:, 0] < w) & (img[:, 1] >= 0) & (img[:, 1] < h)
    return img[inside], int(inside.sum())


def _score(h_court_to_img: np.ndarray, dilated: np.ndarray) -> float:
    pts, n = _samples(h_court_to_img, dilated.shape)
    if n < 60:
        return 0.0
    xs = pts[:, 0].astype(int)
    ys = pts[:, 1].astype(int)
    hits = dilated[ys, xs] > 0
    # Reward explaining many painted pixels, not just a few lines that happen to fit.
    return float(hits.mean()) * min(1.0, n / 300)


def _plausible(h_court_to_img: np.ndarray, shape: tuple[int, int]) -> bool:
    h, w = shape
    quad = cm.apply_homography(h_court_to_img, cm.SINGLES_CORNERS_M)
    if not np.all(np.isfinite(quad)):
        return False
    # Behind-the-baseline view: far baseline above the near one, left stays left.
    near_l, near_r, far_r, far_l = quad
    if not (far_l[1] < near_l[1] and far_r[1] < near_r[1] and near_l[0] < near_r[0] and far_l[0] < far_r[0]):
        return False
    # Every edge has real length (no corners collapsing onto each other), the far
    # baseline is shorter than the near one (perspective), and the shape is convex.
    diag = float(np.hypot(w, h))
    edges = [np.linalg.norm(quad[i] - quad[(i + 1) % 4]) for i in range(4)]
    if min(edges) < 0.04 * diag:
        return False
    if np.linalg.norm(far_r - far_l) > 1.05 * np.linalg.norm(near_r - near_l):
        return False
    if not cv2.isContourConvex(quad.astype(np.float32)):
        return False
    area = cv2.contourArea(quad.astype(np.float32))
    if area < 0.03 * w * h or area > 4.0 * w * h:
        return False
    # The far half has to be on screen; the near baseline may be cut off.
    far_mid = (far_l + far_r) / 2
    return -0.1 * h < far_mid[1] < 0.9 * h and -0.2 * w < far_mid[0] < 1.2 * w


def detect_court(frame: np.ndarray, max_lines: int = 8) -> CourtFit | None:
    """Finds the court in one frame. Returns None when nothing fits well enough."""
    h, w = frame.shape[:2]
    scale = 960 / max(h, w) if max(h, w) > 960 else 1.0
    small = cv2.resize(frame, (int(w * scale), int(h * scale))) if scale != 1.0 else frame
    sh, sw = small.shape[:2]
    mask = line_mask(small)
    lines = _hough_lines(mask)
    across = [l for l in lines if abs(l[1] - np.pi / 2) < np.deg2rad(25)][:max_lines]
    along = [l for l in lines if abs(l[1] - np.pi / 2) >= np.deg2rad(25)][:max_lines]
    if len(across) < 2 or len(along) < 2:
        return None
    dilated = cv2.dilate(mask, np.ones((5, 5), np.uint8))

    best = (0.0, None)

    def y_at_center(line: tuple) -> float:
        return (line[0] - (sw / 2) * np.cos(line[1])) / np.sin(line[1])

    across_pairs = [(a, b) if y_at_center(a) < y_at_center(b) else (b, a)
                    for a, b in itertools.combinations(across, 2)]       # (upper, lower)
    along_pairs = []
    for a, b in itertools.combinations(along, 2):
        ya = sh * 0.7
        xa = (a[0] - ya * np.sin(a[1])) / np.cos(a[1]) if abs(np.cos(a[1])) > 1e-6 else a[0]
        xb = (b[0] - ya * np.sin(b[1])) / np.cos(b[1]) if abs(np.cos(b[1])) > 1e-6 else b[0]
        along_pairs.append((a, b) if xa < xb else (b, a))                # (left, right)

    for (upper, lower), (left, right) in itertools.product(across_pairs, along_pairs):
        img_pts = [_intersect(lower, left), _intersect(lower, right), _intersect(upper, right), _intersect(upper, left)]
        if any(p is None for p in img_pts):
            continue
        for y_far, y_near in itertools.combinations(_ACROSS, 2):          # y_far > y_near
            for x_left, x_right in itertools.combinations(_ALONG, 2):
                court_pts = [(x_left, y_near), (x_right, y_near), (x_right, y_far), (x_left, y_far)]
                try:
                    h_ci = cm.homography(court_pts, img_pts)
                except (ValueError, np.linalg.LinAlgError):
                    continue
                if not _plausible(h_ci, (sh, sw)):
                    continue
                s = _score(h_ci, dilated)
                if s > best[0]:
                    best = (s, h_ci)

    score, h_ci = best
    if h_ci is None or score < 0.35:
        return None
    corners_px = cm.apply_homography(h_ci, cm.SINGLES_CORNERS_M)
    corners = [[float(x / sw), float(y / sh)] for x, y in corners_px]
    return CourtFit(corners=corners, confidence=round(score, 3), source="detected")


def detect_court_in_video(path: str, sample_seconds: list[float] | None = None) -> CourtFit | None:
    """Tries a few frames (players can hide lines) and keeps the best fit."""
    from services.pipeline.video import read_frames, video_info

    info = video_info(path)
    times = sample_seconds or [t for t in (1, 5, 15, 30, 60, 120) if t < max(info.duration, 1)] or [0]
    frames = read_frames(path, [int(t * info.fps) for t in times])
    fits = [f for f in (detect_court(fr) for fr in frames.values()) if f]
    return max(fits, key=lambda f: f.confidence) if fits else None


def from_phone(calibration: dict | list | None) -> CourtFit | None:
    """
    Accepts the phone's four corners: either a plain list of [x, y] in calibration
    order, or the legacy {"pointOrder": [...], "points": [{"x", "y"}]} shape.
    """
    if not calibration:
        return None
    if isinstance(calibration, dict):
        points = calibration.get("points") or calibration.get("corners")
        if not isinstance(points, list):
            return None
        corners = [[float(p["x"]), float(p["y"])] if isinstance(p, dict) else [float(p[0]), float(p[1])] for p in points]
    else:
        corners = [[float(p[0]), float(p[1])] for p in calibration]
    if len(corners) != 4:
        return None
    quad = np.array(corners, dtype=np.float32)
    if cv2.contourArea(quad) < 0.005 or not cv2.isContourConvex(quad):
        return None
    return CourtFit(corners=corners, confidence=1.0, source="phone")
