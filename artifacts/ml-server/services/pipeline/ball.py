"""
Ball detection and tracking.

WASBDetector runs WASB (NTT Communications, MIT license; Tarashima et al.,
"Widely Applicable Strong Baseline for Sports Ball Detection and Tracking",
BMVC 2023) through ONNX Runtime on CPU. Pre- and post-processing match the
WASB repo: three frames warped to 512x288, ImageNet-normalized RGB stacked to
9 channels; one heatmap per frame, sigmoid, threshold 0.5, weighted blob centers.

MotionDetector is a no-weights fallback (moving small blobs). It keeps the
pipeline runnable before the model file is in place, and drives the tests.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Protocol

import cv2
import numpy as np

Candidate = tuple[float, float, float]   # x px, y px, score


class BallDetector(Protocol):
    name: str
    frames_in: int

    def detect(self, frames: list[np.ndarray]) -> list[list[Candidate]]:
        """Candidates for each of the given frames, in that frame's pixel coordinates."""
        ...


# ─── WASB (ONNX) ─────────────────────────────────────────────────────────────

_IMAGENET_MEAN = np.array([0.485, 0.456, 0.406], dtype=np.float32)
_IMAGENET_STD = np.array([0.229, 0.224, 0.225], dtype=np.float32)


class WASBDetector:
    name = "wasb-tennis"
    frames_in = 3
    input_wh = (512, 288)

    def __init__(self, onnx_path: str, threshold: float = 0.5, threads: int | None = None):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(onnx_path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name
        self.threshold = threshold

    def _warp(self, shape: tuple[int, int]) -> tuple[np.ndarray, np.ndarray]:
        """Letterbox affine from the frame into the model input, and its inverse."""
        h, w = shape
        iw, ih = self.input_wh
        s = min(iw / w, ih / h)
        ox, oy = (iw - w * s) / 2, (ih - h * s) / 2
        fwd = np.array([[s, 0, ox], [0, s, oy]], dtype=np.float32)
        inv = np.array([[1 / s, 0, -ox / s], [0, 1 / s, -oy / s]], dtype=np.float32)
        return fwd, inv

    def preprocess(self, frames: list[np.ndarray]) -> tuple[np.ndarray, np.ndarray]:
        fwd, inv = self._warp(frames[0].shape[:2])
        chans = []
        for f in frames:
            warped = cv2.warpAffine(f, fwd, self.input_wh, flags=cv2.INTER_LINEAR)
            rgb = cv2.cvtColor(warped, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
            chans.append(((rgb - _IMAGENET_MEAN) / _IMAGENET_STD).transpose(2, 0, 1))
        return np.concatenate(chans, axis=0)[None].astype(np.float32), inv

    def postprocess(self, heatmaps: np.ndarray, inv: np.ndarray) -> list[list[Candidate]]:
        out = []
        for hm in heatmaps:
            hm = 1.0 / (1.0 + np.exp(-hm))
            cands: list[Candidate] = []
            if hm.max() > self.threshold:
                binary = (hm > self.threshold).astype(np.uint8)
                n, labels = cv2.connectedComponents(binary)
                for m in range(1, n):
                    ys, xs = np.where(labels == m)
                    ws = hm[ys, xs]
                    x, y = float((xs * ws).sum() / ws.sum()), float((ys * ws).sum() / ws.sum())
                    px = inv @ np.array([x, y, 1.0], dtype=np.float32)
                    cands.append((float(px[0]), float(px[1]), float(ws.sum())))
            cands.sort(key=lambda c: -c[2])
            out.append(cands)
        return out

    def detect(self, frames: list[np.ndarray]) -> list[list[Candidate]]:
        x, inv = self.preprocess(frames)
        heatmaps = self.session.run(None, {self.input_name: x})[0][0]
        return self.postprocess(heatmaps, inv)


# ─── Motion fallback ─────────────────────────────────────────────────────────

class MotionDetector:
    """Small, optic-yellow blobs that move between frames. Weak on real footage; fine for tests."""
    name = "motion"
    frames_in = 3

    def __init__(self, min_area_frac: float = 2e-6, max_area_frac: float = 6e-4):
        self.min_area_frac = min_area_frac
        self.max_area_frac = max_area_frac

    def detect(self, frames: list[np.ndarray]) -> list[list[Candidate]]:
        grays = [cv2.GaussianBlur(cv2.cvtColor(f, cv2.COLOR_BGR2GRAY), (3, 3), 0) for f in frames]
        out: list[list[Candidate]] = []
        h, w = grays[0].shape
        area = h * w
        for i in range(len(grays)):
            prev = grays[max(0, i - 1)]
            nxt = grays[min(len(grays) - 1, i + 1)]
            cur = grays[i]
            d1 = cv2.absdiff(cur, prev)
            d2 = cv2.absdiff(cur, nxt)
            moving = cv2.min(d1, d2) if (i > 0 and i < len(grays) - 1) else cv2.max(d1, d2)
            mask = (moving > 25).astype(np.uint8)
            n, labels, stats, centroids = cv2.connectedComponentsWithStats(mask)
            hsv = cv2.cvtColor(frames[i], cv2.COLOR_BGR2HSV)
            cands = []
            for k in range(1, n):
                a = stats[k, cv2.CC_STAT_AREA]
                if not (self.min_area_frac * area <= a <= self.max_area_frac * area):
                    continue
                bw, bh = stats[k, cv2.CC_STAT_WIDTH], stats[k, cv2.CC_STAT_HEIGHT]
                if max(bw, bh) > 4 * max(1, min(bw, bh)):
                    continue
                cx, cy = centroids[k]
                hue, sat, val = hsv[int(cy), int(cx)]
                if not (20 <= hue <= 45 and sat > 80 and val > 120):
                    continue                      # optic yellow only: players and rackets move too
                ballish = 1.0
                cands.append((float(cx), float(cy), float(ballish * moving[labels == k].mean() / 255.0)))
            cands.sort(key=lambda c: -c[2])
            if cands:
                cands = [c for c in cands if c[2] >= 0.3 * cands[0][2]]
            out.append(cands[:8])
        return out


# ─── Tracking ────────────────────────────────────────────────────────────────

@dataclass
class BallTrack:
    xy: np.ndarray          # (N, 2) pixel coords, NaN when not seen
    score: np.ndarray       # (N,) detection score, 0 when interpolated or missing
    interpolated: np.ndarray  # (N,) bool

    def __len__(self) -> int:
        return len(self.xy)

    def visible(self) -> np.ndarray:
        return ~np.isnan(self.xy[:, 0])


def run_detector(detector: BallDetector, frame_iter, frame_count_hint: int = 0) -> list[list[Candidate]]:
    """Feeds frames to the detector in groups of `frames_in`, like WASB's step=frames_in eval."""
    candidates: list[list[Candidate]] = []
    batch: list[np.ndarray] = []
    for _, frame in frame_iter:
        batch.append(frame)
        if len(batch) == detector.frames_in:
            candidates.extend(detector.detect(batch))
            batch = []
    if batch:
        # Pad the tail by repeating the last frame, then drop the padded results.
        n = len(batch)
        batch = batch + [batch[-1]] * (detector.frames_in - n)
        candidates.extend(detector.detect(batch)[:n])
    return candidates


def track_ball(candidates: list[list[Candidate]], frame_width: int, max_gap: int = 6,
               max_disp_frac: float = 300 / 1280) -> BallTrack:
    """
    Online tracking in the style of WASB's tracker: pick the candidate closest to
    where the ball should be (constant velocity), within a maximum jump. Then
    drop one-frame outliers and fill short gaps by interpolation.
    """
    n = len(candidates)
    xy = np.full((n, 2), np.nan)
    score = np.zeros(n)
    max_disp = max_disp_frac * frame_width
    last: list[tuple[int, np.ndarray]] = []
    for i, cands in enumerate(candidates):
        if not cands:
            continue
        if last and i - last[-1][0] <= max_gap:
            j, p = last[-1]
            if len(last) >= 2 and last[-1][0] - last[-2][0] <= max_gap:
                v = (p - last[-2][1]) / (last[-1][0] - last[-2][0])
                pred = p + v * (i - j)
            else:
                pred = p
            best = min(cands, key=lambda c: math.hypot(c[0] - pred[0], c[1] - pred[1]))
            if math.hypot(best[0] - pred[0], best[1] - pred[1]) > max_disp * (i - j):
                # Lost it: restart from the strongest candidate.
                best = cands[0]
                last = []
        else:
            best = cands[0]
            last = []
        xy[i] = best[:2]
        score[i] = best[2]
        last.append((i, np.array(best[:2])))
        last = last[-2:]

    # One-frame outliers: a point far from both neighbors that agree with each other.
    for i in range(1, n - 1):
        if np.isnan(xy[i - 1, 0]) or np.isnan(xy[i, 0]) or np.isnan(xy[i + 1, 0]):
            continue
        mid = (xy[i - 1] + xy[i + 1]) / 2
        span = np.linalg.norm(xy[i + 1] - xy[i - 1]) + 4
        if np.linalg.norm(xy[i] - mid) > 2.5 * span:
            xy[i] = np.nan
            score[i] = 0

    interpolated = np.zeros(n, dtype=bool)
    seen = np.where(~np.isnan(xy[:, 0]))[0]
    for a, b in zip(seen[:-1], seen[1:]):
        if 1 < b - a <= max_gap + 1:
            for k in range(a + 1, b):
                t = (k - a) / (b - a)
                xy[k] = xy[a] * (1 - t) + xy[b] * t
                interpolated[k] = True
    return BallTrack(xy=xy, score=score, interpolated=interpolated)
