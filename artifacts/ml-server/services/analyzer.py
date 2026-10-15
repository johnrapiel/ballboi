"""
Shot analysis pipeline using YOLOv8n, MediaPipe, and scikit-learn.
Analyzes tennis shot videos to detect ball, classify shot type, estimate outcome.
"""
import os
import sys
import json
import time
import math
import base64
import logging
import tempfile
import urllib.request
from pathlib import Path

import numpy as np
import cv2

logger = logging.getLogger(__name__)

# ─── Constants ───────────────────────────────────────────────────────────────
SHOT_TYPES = ["serve", "forehand", "backhand", "volley", "overhead", "unknown"]
OUTCOMES = ["winner", "error", "unforced_error", "rally_continuation"]
COURT_ZONES = ["service_box_deuce", "service_box_ad", "baseline_left", "baseline_right", "net", "out"]
SPIN_TYPES = ["topspin", "slice", "flat", "unknown"]
DEPTHS = ["net", "service_line", "baseline", "deep", "unknown"]
STANCES = ["closed", "open", "neutral", "unknown"]
COURT_CALIBRATION_POINT_ORDER = ["Near left baseline", "Near right baseline", "Far right baseline", "Far left baseline"]

# ─── Lazy imports (only load on first use to speed up startup) ────────────────
_yolo_model = None
_mp_pose = None
_mp_drawing = None


def _get_yolo():
    """Lazy-load YOLOv8n model."""
    global _yolo_model
    if _yolo_model is None:
        try:
            from ultralytics import YOLO
            _yolo_model = YOLO("yolov8n.pt")  # auto-downloads on first run
            logger.info("YOLOv8n loaded")
        except Exception as e:
            logger.warning(f"YOLO unavailable: {e}. Using fallback ball detection.")
            _yolo_model = "fallback"
    return _yolo_model


def _get_mediapipe():
    """Lazy-load MediaPipe pose."""
    global _mp_pose, _mp_drawing
    if _mp_pose is None:
        try:
            import mediapipe as mp
            _mp_pose = mp.solutions.pose
            _mp_drawing = mp.solutions.drawing_utils
            logger.info("MediaPipe pose loaded")
        except Exception as e:
            logger.warning(f"MediaPipe unavailable: {e}")
            _mp_pose = "fallback"
    return _mp_pose


# ─── Ball Detection ───────────────────────────────────────────────────────────

def detect_balls_yolo(frames: list[np.ndarray]) -> list[dict | None]:
    """Detect sports balls in frames using YOLOv8."""
    model = _get_yolo()
    detections = []

    if model == "fallback":
        return detect_balls_color(frames)

    for frame in frames:
        try:
            results = model(frame, verbose=False, classes=[32])  # 32 = sports ball in COCO
            if results and len(results[0].boxes) > 0:
                box = results[0].boxes[0]
                x1, y1, x2, y2 = box.xyxy[0].tolist()
                cx = (x1 + x2) / 2 / frame.shape[1]
                cy = (y1 + y2) / 2 / frame.shape[0]
                conf = float(box.conf[0])
                detections.append({"x": cx, "y": cy, "confidence": conf})
            else:
                detections.append(None)
        except Exception as e:
            logger.warning(f"YOLO frame error: {e}")
            detections.append(None)

    return detections


def detect_balls_color(frames: list[np.ndarray]) -> list[dict | None]:
    """Fallback: detect yellow-green tennis ball by color."""
    detections = []
    for frame in frames:
        try:
            hsv = cv2.cvtColor(frame, cv2.COLOR_BGR2HSV)
            # Tennis ball color range (yellow-green)
            lower = np.array([25, 100, 100])
            upper = np.array([65, 255, 255])
            mask = cv2.inRange(hsv, lower, upper)
            mask = cv2.erode(mask, None, iterations=2)
            mask = cv2.dilate(mask, None, iterations=2)

            contours, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
            if contours:
                c = max(contours, key=cv2.contourArea)
                area = cv2.contourArea(c)
                if area > 50:
                    M = cv2.moments(c)
                    cx = M["m10"] / M["m00"] / frame.shape[1]
                    cy = M["m01"] / M["m00"] / frame.shape[0]
                    detections.append({"x": cx, "y": cy, "confidence": min(area / 500, 0.9)})
                    continue
            detections.append(None)
        except Exception:
            detections.append(None)
    return detections


# ─── Pose Estimation ──────────────────────────────────────────────────────────

def estimate_pose(frames: list[np.ndarray]) -> list[dict | None]:
    """Extract player pose keypoints using MediaPipe."""
    mp_pose = _get_mediapipe()
    if mp_pose == "fallback":
        return [None] * len(frames)

    pose_results = []
    try:
        import mediapipe as mp
        with mp_pose.Pose(
            static_image_mode=False,
            model_complexity=1,
            min_detection_confidence=0.5,
            min_tracking_confidence=0.5,
        ) as pose:
            for frame in frames:
                rgb = cv2.cvtColor(frame, cv2.COLOR_BGR2RGB)
                results = pose.process(rgb)
                if results.pose_landmarks:
                    landmarks = results.pose_landmarks.landmark
                    kps = {
                        "left_wrist": (landmarks[mp.solutions.pose.PoseLandmark.LEFT_WRIST].x,
                                       landmarks[mp.solutions.pose.PoseLandmark.LEFT_WRIST].y),
                        "right_wrist": (landmarks[mp.solutions.pose.PoseLandmark.RIGHT_WRIST].x,
                                        landmarks[mp.solutions.pose.PoseLandmark.RIGHT_WRIST].y),
                        "left_shoulder": (landmarks[mp.solutions.pose.PoseLandmark.LEFT_SHOULDER].x,
                                          landmarks[mp.solutions.pose.PoseLandmark.LEFT_SHOULDER].y),
                        "right_shoulder": (landmarks[mp.solutions.pose.PoseLandmark.RIGHT_SHOULDER].x,
                                           landmarks[mp.solutions.pose.PoseLandmark.RIGHT_SHOULDER].y),
                        "left_hip": (landmarks[mp.solutions.pose.PoseLandmark.LEFT_HIP].x,
                                     landmarks[mp.solutions.pose.PoseLandmark.LEFT_HIP].y),
                        "right_hip": (landmarks[mp.solutions.pose.PoseLandmark.RIGHT_HIP].x,
                                      landmarks[mp.solutions.pose.PoseLandmark.RIGHT_HIP].y),
                        "nose": (landmarks[mp.solutions.pose.PoseLandmark.NOSE].x,
                                 landmarks[mp.solutions.pose.PoseLandmark.NOSE].y),
                    }
                    pose_results.append(kps)
                else:
                    pose_results.append(None)
    except Exception as e:
        logger.warning(f"MediaPipe error: {e}")
        return [None] * len(frames)

    return pose_results


# ─── Shot Classification ──────────────────────────────────────────────────────

def classify_shot_type(ball_detections: list, pose_keypoints: list, frame_count: int) -> tuple[str, float]:
    """
    Classify shot type from ball trajectory and player pose.
    Uses heuristics from pose + ball position (contact side, wrist position).
    """
    valid_poses = [p for p in pose_keypoints if p is not None]
    valid_balls = [b for b in ball_detections if b is not None]

    if not valid_poses and not valid_balls:
        return "unknown", 0.4

    # Heuristic: if ball detected in upper portion of frame and fast motion → serve/overhead
    if valid_balls:
        avg_ball_y = sum(b["y"] for b in valid_balls) / len(valid_balls)
        ball_y_min = min(b["y"] for b in valid_balls)
    else:
        avg_ball_y = 0.5
        ball_y_min = 0.5

    if valid_poses:
        last_pose = valid_poses[-1]
        mid_pose = valid_poses[len(valid_poses) // 2]

        # Check contact side
        right_wrist_x = last_pose.get("right_wrist", (0.5, 0.5))[0]
        left_wrist_x = last_pose.get("left_wrist", (0.5, 0.5))[0]
        right_shoulder_x = last_pose.get("right_shoulder", (0.5, 0.5))[0]

        right_wrist_y = last_pose.get("right_wrist", (0.5, 0.5))[1]
        left_wrist_y = last_pose.get("left_wrist", (0.5, 0.5))[1]
        shoulder_y = last_pose.get("right_shoulder", (0.5, 0.5))[1]

        # Wrist above shoulder → serve or overhead
        dominant_wrist_y = min(right_wrist_y, left_wrist_y)
        if dominant_wrist_y < shoulder_y - 0.1 or ball_y_min < 0.25:
            if ball_y_min < 0.2:
                shot_type = "overhead"
                conf = 0.78
            else:
                shot_type = "serve"
                conf = 0.82
        # Contact near net → volley
        elif avg_ball_y < 0.35:
            shot_type = "volley"
            conf = 0.74
        # Forehand vs backhand based on contact side relative to body
        elif right_wrist_x > right_shoulder_x:
            shot_type = "forehand"
            conf = 0.76
        else:
            shot_type = "backhand"
            conf = 0.73
    else:
        # No pose — use ball position heuristic
        if ball_y_min < 0.3:
            shot_type = "serve"
        elif avg_ball_y < 0.4:
            shot_type = "volley"
        else:
            shot_type = "forehand" if valid_balls and valid_balls[-1]["x"] >= 0.5 else "backhand"
        conf = 0.55

    return shot_type, conf


def classify_outcome(
    ball_detections: list,
    court_zone: str,
    shot_type: str,
) -> tuple[str, float]:
    """
    Classify shot outcome using Random Forest-like heuristics from:
    - Ball trajectory (last known position, y-trend)
    - Court zone (where ball lands)
    - Shot type context
    """
    valid_balls = [b for b in ball_detections if b is not None]

    # Map court zone to outcome probabilities
    zone_outcome_weights = {
        "service_box_deuce": {"winner": 0.3, "error": 0.1, "unforced_error": 0.05, "rally_continuation": 0.55},
        "service_box_ad": {"winner": 0.25, "error": 0.1, "unforced_error": 0.05, "rally_continuation": 0.6},
        "baseline_left": {"winner": 0.2, "error": 0.1, "unforced_error": 0.1, "rally_continuation": 0.6},
        "baseline_right": {"winner": 0.2, "error": 0.1, "unforced_error": 0.1, "rally_continuation": 0.6},
        "net": {"winner": 0.02, "error": 0.55, "unforced_error": 0.35, "rally_continuation": 0.08},
        "out": {"winner": 0.0, "error": 0.6, "unforced_error": 0.4, "rally_continuation": 0.0},
    }

    weights = zone_outcome_weights.get(court_zone, {
        "winner": 0.15, "error": 0.2, "unforced_error": 0.15, "rally_continuation": 0.5
    })

    # Modify by shot type
    if shot_type == "serve" and court_zone in ("service_box_deuce", "service_box_ad"):
        weights["winner"] = min(weights["winner"] + 0.15, 0.5)  # aces possible
    elif shot_type in ("volley", "overhead") and court_zone not in ("net", "out"):
        weights["winner"] = min(weights["winner"] + 0.2, 0.6)  # net shots more decisive

    # Ball trajectory: if ball was moving toward bottom of frame at end → error
    if valid_balls and len(valid_balls) >= 3:
        last_y = valid_balls[-1]["y"]
        prev_y = valid_balls[-3]["y"]
        if last_y < prev_y - 0.1:  # ball going up = lob or high ball = less likely winner
            weights["winner"] = max(weights["winner"] - 0.1, 0.0)
            weights["rally_continuation"] = min(weights["rally_continuation"] + 0.1, 0.8)

    outcomes_list = list(weights.keys())
    probs = list(weights.values())
    total = sum(probs)
    outcome = outcomes_list[probs.index(max(probs))]
    conf = weights[outcome] / total * 1.2
    conf = min(conf, 0.95)

    return outcome, conf


# ─── Court Zone Detection ─────────────────────────────────────────────────────

def detect_court_zone(ball_detections: list, shot_type: str) -> tuple[str, float, float]:
    """
    Determine where ball lands on court using last-known ball position.
    Returns (zone_name, x_normalized, y_normalized).
    """
    valid_balls = [b for b in ball_detections if b is not None]

    if not valid_balls:
        return "unknown", 0.5, 0.5

    # Use last ball position
    last = valid_balls[-1]
    x, y = last["x"], last["y"]

    # Map normalized position to court zone
    if y < 0.15:
        zone = "net"
    elif y < 0.45:
        zone = "service_box_deuce" if x < 0.5 else "service_box_ad"
    elif y < 0.85:
        zone = "baseline_left" if x < 0.5 else "baseline_right"
    elif x < 0.05 or x > 0.95 or y > 0.95:
        zone = "out"
    else:
        zone = "baseline_left" if x < 0.5 else "baseline_right"

    return zone, x, y


def _normalize_calibration(calibration: dict | None) -> list[tuple[float, float]] | None:
    if not isinstance(calibration, dict):
        return None
    point_order = calibration.get("pointOrder")
    if not isinstance(point_order, list) or point_order[:4] != COURT_CALIBRATION_POINT_ORDER:
        return None
    points = calibration.get("points")
    if not isinstance(points, list) or len(points) != 4:
        return None
    normalized = []
    for point in points:
        if not isinstance(point, dict):
            return None
        x = point.get("x")
        y = point.get("y")
        if not isinstance(x, (int, float)) or not isinstance(y, (int, float)):
            return None
        normalized.append((float(max(0, min(1, x))), float(max(0, min(1, y)))))
    area = abs(sum(
        normalized[index][0] * normalized[(index + 1) % len(normalized)][1] - normalized[(index + 1) % len(normalized)][0] * normalized[index][1]
        for index in range(len(normalized))
    ) / 2)
    if area < 0.01:
        return None
    cross_products = []
    for index, point in enumerate(normalized):
        next_point = normalized[(index + 1) % len(normalized)]
        after_next = normalized[(index + 2) % len(normalized)]
        cross_products.append((next_point[0] - point[0]) * (after_next[1] - next_point[1]) - (next_point[1] - point[1]) * (after_next[0] - next_point[0]))
    if any(abs(cross) < 0.001 for cross in cross_products):
        return None
    if any(cross > 0 for cross in cross_products) and any(cross < 0 for cross in cross_products):
        return None
    return normalized


def detect_court_lines_from_frame(frame_b64: str) -> dict:
    """
    Detect tennis court boundary lines from a base64-encoded JPEG frame.
    Returns 4 corner points in calibration order:
      [near-left, near-right, far-right, far-left]
    as normalized 0–1 coordinates, plus a confidence score.
    """
    try:
        data = frame_b64.split(",", 1)[-1]  # strip data URL prefix if present
        img_bytes = base64.b64decode(data)
        img_array = np.frombuffer(img_bytes, np.uint8)
        img = cv2.imdecode(img_array, cv2.IMREAD_COLOR)
        if img is None:
            return {"success": False, "error": "Failed to decode image"}

        h, w = img.shape[:2]

        # ── 1. Isolate bright/white regions (court lines) ───────────────────
        hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
        white_mask = cv2.inRange(hsv, np.array([0, 0, 180]), np.array([180, 60, 255]))
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        _, bright_mask = cv2.threshold(gray, 195, 255, cv2.THRESH_BINARY)
        line_mask = cv2.bitwise_or(white_mask, bright_mask)
        kernel = cv2.getStructuringElement(cv2.MORPH_RECT, (3, 3))
        line_mask = cv2.morphologyEx(line_mask, cv2.MORPH_CLOSE, kernel)

        # ── 2. Edge detection + Hough line segments ─────────────────────────
        min_dim = min(w, h)
        edges_mask = cv2.Canny(line_mask, 50, 150, apertureSize=3)
        edges_gray = cv2.Canny(gray, 50, 150, apertureSize=3)
        edges = cv2.bitwise_or(edges_mask, edges_gray)

        min_len = min_dim * 0.10
        lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=35,
                                minLineLength=min_len, maxLineGap=25)

        if lines is None or len(lines) < 4:
            lines = cv2.HoughLinesP(edges, 1, np.pi / 180, threshold=25,
                                    minLineLength=min_len * 0.6, maxLineGap=40)

        if lines is None or len(lines) < 4:
            return {"success": False, "error": "Not enough line segments detected — ensure the full court is visible"}

        # ── 3. Classify into horizontal (≤35°) and vertical (≥55°) groups ──
        h_lines, v_lines = [], []
        for seg in lines:
            x1, y1, x2, y2 = seg[0]
            angle = abs(np.degrees(np.arctan2(float(y2 - y1), float(x2 - x1))))
            if angle > 90:
                angle = 180 - angle
            length = float(np.hypot(x2 - x1, y2 - y1))
            if angle <= 35:
                h_lines.append((x1, y1, x2, y2, length))
            elif angle >= 55:
                v_lines.append((x1, y1, x2, y2, length))

        # Need at least 2 of each to form a quad
        if len(h_lines) < 2 or len(v_lines) < 2:
            return {
                "success": False,
                "error": f"Could not find enough horizontal and vertical lines ({len(h_lines)}H / {len(v_lines)}V) — aim the camera to show the full court",
            }

        # ── 4. Pick boundary lines ──────────────────────────────────────────
        def mid_y(seg): return (seg[1] + seg[3]) / 2.0
        def mid_x(seg): return (seg[0] + seg[2]) / 2.0

        h_lines.sort(key=mid_y)
        top_h = h_lines[0]        # far baseline (small y = top of image)
        bottom_h = h_lines[-1]    # near baseline (large y = bottom of image)

        v_lines.sort(key=mid_x)
        left_v = v_lines[0]       # left sideline
        right_v = v_lines[-1]     # right sideline

        # ── 5. Compute intersections ────────────────────────────────────────
        def intersect(l1, l2):
            x1, y1, x2, y2 = l1[:4]
            x3, y3, x4, y4 = l2[:4]
            denom = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4)
            if abs(denom) < 1e-8:
                return None
            t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / denom
            return (x1 + t * (x2 - x1), y1 + t * (y2 - y1))

        raw = [
            intersect(bottom_h, left_v),   # near-left
            intersect(bottom_h, right_v),  # near-right
            intersect(top_h, right_v),     # far-right
            intersect(top_h, left_v),      # far-left
        ]
        if any(c is None for c in raw):
            return {"success": False, "error": "Could not compute all 4 court corners — try adjusting the camera angle"}

        corners = [{"x": round(float(cx) / w, 4), "y": round(float(cy) / h, 4)} for cx, cy in raw]

        # ── 6. Sanity checks ────────────────────────────────────────────────
        in_bounds = sum(-0.15 <= c["x"] <= 1.15 and -0.15 <= c["y"] <= 1.15 for c in corners)
        if in_bounds < 4:
            return {"success": False, "error": "Detected corners are outside the frame — ensure the full court is in view"}

        xs = [c["x"] for c in corners]
        ys = [c["y"] for c in corners]
        area = (max(xs) - min(xs)) * (max(ys) - min(ys))
        if area < 0.04:
            return {"success": False, "error": "Detected court area is too small — move the camera further back"}

        # Clamp corners to image bounds
        corners = [{"x": max(0.0, min(1.0, c["x"])), "y": max(0.0, min(1.0, c["y"]))} for c in corners]

        confidence = round(min(1.0, min(1.0, len(lines) / 20) * 0.5 + (area / 0.3) * 0.3 + (in_bounds / 4) * 0.2), 3)

        return {
            "success": True,
            "corners": corners,
            "confidence": confidence,
            "linesDetected": int(len(lines)),
        }

    except Exception as exc:
        logger.error(f"Court detection error: {exc}", exc_info=True)
        return {"success": False, "error": f"Detection failed: {exc}"}


def _map_to_calibrated_court_points(x: float, y: float, points: list[tuple[float, float]]) -> tuple[float, float]:
    try:
        src = np.array(points, dtype=np.float32)
        dst = np.array([[0.0, 1.0], [1.0, 1.0], [1.0, 0.0], [0.0, 0.0]], dtype=np.float32)
        matrix = cv2.getPerspectiveTransform(src, dst)
        mapped = cv2.perspectiveTransform(np.array([[[x, y]]], dtype=np.float32), matrix)[0][0]
        return float(max(0, min(1, mapped[0]))), float(max(0, min(1, mapped[1])))
    except Exception:
        return x, y


def detect_calibrated_court_zone(ball_detections: list, shot_type: str, calibration: dict | None) -> tuple[str, float, float]:
    zone, x, y = detect_court_zone(ball_detections, shot_type)
    valid_calibration = _normalize_calibration(calibration)
    if not valid_calibration:
        return zone, x, y
    mapped_x, mapped_y = _map_to_calibrated_court_points(x, y, valid_calibration)
    if mapped_y < 0.08:
        mapped_zone = "out"
    elif abs(mapped_y - 0.5) < 0.04:
        mapped_zone = "net"
    elif mapped_y < 0.5:
        mapped_zone = "service_box_deuce" if mapped_x < 0.5 else "service_box_ad"
    elif mapped_y < 0.92:
        mapped_zone = "baseline_left" if mapped_x < 0.5 else "baseline_right"
    elif mapped_x < 0.03 or mapped_x > 0.97:
        mapped_zone = "out"
    else:
        mapped_zone = "baseline_left" if mapped_x < 0.5 else "baseline_right"
    return mapped_zone, mapped_x, mapped_y


# ─── Trajectory Analysis ──────────────────────────────────────────────────────

def analyze_trajectory(ball_detections: list, fps: float) -> dict:
    """Estimate speed, spin, depth, and angle from ball trajectory."""
    valid_balls = [(i, b) for i, b in enumerate(ball_detections) if b is not None]

    if len(valid_balls) < 2:
        return {
            "speed_mph": 0.0,
            "spin": "unknown",
            "depth": "unknown",
            "angle_degrees": 0.0,
        }

    # Speed from displacement
    first_idx, first = valid_balls[0]
    last_idx, last = valid_balls[-1]
    dx = (last["x"] - first["x"]) * 23.77  # court is ~23.77m wide (singles)
    dy = (last["y"] - first["y"]) * 11.885  # half court ~11.885m
    distance_m = math.sqrt(dx ** 2 + dy ** 2)
    time_s = (last_idx - first_idx) / max(fps, 1)
    speed_ms = distance_m / max(time_s, 0.001)
    speed_mph = speed_ms * 2.237

    # Clamp to realistic tennis speeds
    speed_mph = max(15.0, min(speed_mph, 150.0))

    # Angle from center
    angle = math.degrees(math.atan2(dx, dy)) if dy != 0 else 0.0

    # Depth from y position of landing
    last_y = last["y"]
    if last_y < 0.4:
        depth = "net"
    elif last_y < 0.6:
        depth = "service_line"
    elif last_y < 0.8:
        depth = "baseline"
    else:
        depth = "deep"

    # Spin from y-trajectory curvature
    if len(valid_balls) >= 4:
        ys = [b["y"] for _, b in valid_balls]
        mid_y = ys[len(ys) // 2]
        if mid_y < (ys[0] + ys[-1]) / 2 - 0.05:
            spin = "topspin"
        elif mid_y > (ys[0] + ys[-1]) / 2 + 0.05:
            spin = "slice"
        else:
            spin = "flat"
    else:
        spin = "unknown"

    return {
        "speed_mph": round(speed_mph, 1),
        "spin": spin,
        "depth": depth,
        "angle_degrees": round(angle, 1),
    }


# ─── Stance Classification ────────────────────────────────────────────────────

def classify_stance(pose_keypoints: list) -> str:
    """Classify player stance from pose keypoints."""
    valid_poses = [p for p in pose_keypoints if p is not None]
    if not valid_poses:
        return "unknown"

    mid_pose = valid_poses[len(valid_poses) // 2]
    lh = mid_pose.get("left_hip", (0.5, 0.5))
    rh = mid_pose.get("right_hip", (0.5, 0.5))
    ls = mid_pose.get("left_shoulder", (0.5, 0.5))
    rs = mid_pose.get("right_shoulder", (0.5, 0.5))

    hip_angle = abs(lh[0] - rh[0])
    shoulder_angle = abs(ls[0] - rs[0])

    if hip_angle < 0.1:
        return "open"
    elif hip_angle > 0.2 and shoulder_angle > 0.2:
        return "closed"
    return "neutral"


# ─── Contact Point ────────────────────────────────────────────────────────────

def find_contact_point(ball_detections: list, pose_keypoints: list) -> tuple[float, float, int]:
    """Find the frame where ball-wrist distance is minimized (contact point)."""
    min_dist = float("inf")
    contact_x, contact_y, contact_frame = 0.5, 0.5, 0

    for i, (ball, pose) in enumerate(zip(ball_detections, pose_keypoints)):
        if ball is None or pose is None:
            continue
        rw = pose.get("right_wrist", None)
        lw = pose.get("left_wrist", None)
        for wrist in [rw, lw]:
            if wrist is None:
                continue
            dist = math.sqrt((ball["x"] - wrist[0]) ** 2 + (ball["y"] - wrist[1]) ** 2)
            if dist < min_dist:
                min_dist = dist
                contact_x, contact_y, contact_frame = ball["x"], ball["y"], i

    return contact_x, contact_y, contact_frame


# ─── Main Entry Point ─────────────────────────────────────────────────────────

def analyze_video(video_path: str) -> dict:
    """
    Full pipeline: load video → extract frames → detect ball → estimate pose →
    classify shot → estimate trajectory → return structured results.
    """
    start = time.time()

    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")

    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps

    # Sample up to 60 frames evenly (performance vs accuracy tradeoff)
    sample_count = min(60, total_frames)
    frame_indices = [round(i * (total_frames - 1) / max(sample_count - 1, 1)) for i in range(sample_count)] if total_frames > sample_count else list(range(total_frames))

    frames = []
    for idx in frame_indices:
        cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
        ret, frame = cap.read()
        if ret:
            frames.append(frame)
    cap.release()

    if not frames:
        raise ValueError("No frames could be extracted from video")

    logger.info(f"Extracted {len(frames)} frames from {total_frames} total (fps={fps:.1f})")

    # Resize frames for performance
    frames_resized = [cv2.resize(f, (640, 360)) for f in frames]

    # Run detections
    ball_detections = detect_balls_yolo(frames_resized)
    pose_keypoints = estimate_pose(frames_resized)

    # Classify
    shot_type, shot_conf = classify_shot_type(ball_detections, pose_keypoints, len(frames))
    zone_name, zone_x, zone_y = detect_court_zone(ball_detections, shot_type)
    outcome, outcome_conf = classify_outcome(ball_detections, zone_name, shot_type)
    trajectory = analyze_trajectory(ball_detections, fps)
    stance = classify_stance(pose_keypoints)
    contact_x, contact_y, contact_frame = find_contact_point(ball_detections, pose_keypoints)

    processing_ms = int((time.time() - start) * 1000)

    # Prepare compact raw ML data
    raw_ml = {
        "ballDetections": [b for b in ball_detections if b is not None][:20],
        "totalFramesAnalyzed": len(frames),
        "ballDetectionRate": len([b for b in ball_detections if b is not None]) / max(len(ball_detections), 1),
    }

    return {
        "shotType": shot_type,
        "shotTypeConfidence": round(shot_conf, 3),
        "outcome": outcome,
        "outcomeConfidence": round(outcome_conf, 3),
        "courtZone": {
            "name": zone_name,
            "x": round(zone_x, 4),
            "y": round(zone_y, 4),
        },
        "contactPoint": {
            "x": round(contact_x, 4),
            "y": round(contact_y, 4),
            "frameNumber": contact_frame,
        },
        "ballTrajectory": {
            "estimatedSpeedMph": trajectory["speed_mph"],
            "spin": trajectory["spin"],
            "depth": trajectory["depth"],
            "angle": trajectory["angle_degrees"],
        },
        "playerPose": {
            "stance": stance,
        },
        "rawMlData": raw_ml,
        "durationSeconds": round(duration, 2),
        "totalFrames": total_frames,
        "processingTimeMs": processing_ms,
    }


def _analyze_frames(frames: list[np.ndarray], fps: float, timestamp_seconds: float, sequence_number: int, court_calibration: dict | None = None) -> dict | None:
    if not frames:
        return None
    frames_resized = [cv2.resize(f, (640, 360)) for f in frames]
    ball_detections = detect_balls_yolo(frames_resized)
    pose_keypoints = estimate_pose(frames_resized)
    valid_balls = [b for b in ball_detections if b is not None]
    if not valid_balls and not any(pose_keypoints):
        return None
    shot_type, shot_conf = classify_shot_type(ball_detections, pose_keypoints, len(frames))
    zone_name, zone_x, zone_y = detect_calibrated_court_zone(ball_detections, shot_type, court_calibration)
    outcome, outcome_conf = classify_outcome(ball_detections, zone_name, shot_type)
    trajectory = analyze_trajectory(ball_detections, fps)
    stance = classify_stance(pose_keypoints)
    contact_x, contact_y, contact_frame = find_contact_point(ball_detections, pose_keypoints)
    return {
        "sequenceNumber": sequence_number,
        "rallyNumber": (sequence_number - 1) // 5 + 1,
        "timestampSeconds": round(timestamp_seconds, 2),
        "shotType": shot_type,
        "shotTypeConfidence": round(shot_conf, 3),
        "outcome": outcome,
        "outcomeConfidence": round(outcome_conf, 3),
        "courtZone": {"name": zone_name, "x": round(zone_x, 4), "y": round(zone_y, 4)},
        "contactPoint": {"x": round(contact_x, 4), "y": round(contact_y, 4), "frameNumber": contact_frame},
        "ballTrajectory": {
            "estimatedSpeedMph": trajectory["speed_mph"],
            "spin": trajectory["spin"],
            "depth": trajectory["depth"],
            "angle": trajectory["angle_degrees"],
        },
        "playerPose": {"stance": stance},
        "rawMlData": {
            "ballDetections": valid_balls[:10],
            "framesAnalyzed": len(frames),
            "ballDetectionRate": len(valid_balls) / max(len(ball_detections), 1),
            "courtCalibrationApplied": bool(_normalize_calibration(court_calibration)),
        },
    }


def analyze_match_video(video_path: str, court_calibration: dict | None = None) -> dict:
    start = time.time()
    cap = cv2.VideoCapture(video_path)
    if not cap.isOpened():
        raise ValueError(f"Cannot open video: {video_path}")
    fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))
    duration = total_frames / fps if total_frames else 0
    segment_seconds = 8
    segment_count = max(1, min(80, math.ceil(duration / segment_seconds)))
    shots = []
    for segment_index in range(segment_count):
        start_time = segment_index * segment_seconds
        end_time = min(duration, start_time + segment_seconds)
        if end_time <= start_time:
            continue
        frame_count = 12
        frames = []
        for i in range(frame_count):
            timestamp = start_time + (i / max(frame_count - 1, 1)) * (end_time - start_time)
            cap.set(cv2.CAP_PROP_POS_MSEC, timestamp * 1000)
            ret, frame = cap.read()
            if ret:
                frames.append(frame)
        shot = _analyze_frames(frames, fps, start_time + (end_time - start_time) / 2, len(shots) + 1, court_calibration)
        if shot:
            shots.append(shot)
    cap.release()
    return {
        "durationSeconds": round(duration, 2),
        "totalFrames": total_frames,
        "processingTimeMs": int((time.time() - start) * 1000),
        "shots": shots,
        "metadata": {"segmentSeconds": segment_seconds, "segmentsAnalyzed": segment_count, "courtCalibrationApplied": bool(_normalize_calibration(court_calibration))},
    }


def analyze_live_frame(frame_image: str, timestamp_seconds: float, court_calibration: dict | None = None) -> dict | None:
    if "," in frame_image:
        frame_image = frame_image.split(",", 1)[1]
    try:
        data = base64.b64decode(frame_image)
        arr = np.frombuffer(data, np.uint8)
        frame = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    except Exception:
        return None
    if frame is None:
        return None
    shot = _analyze_frames([frame], 30.0, timestamp_seconds, 1, court_calibration)
    if not shot:
        return None
    shot["rawMlData"] = {**shot.get("rawMlData", {}), "live": True, "timestampSeconds": timestamp_seconds}
    return shot
