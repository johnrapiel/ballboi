"""
Players and their pose at the moment of contact.

PoseModel runs a YOLOX person detector and RTMPose (OpenMMLab, Apache-2.0)
through ONNX Runtime on CPU. Processing mirrors rtmlib (Apache-2.0): YOLOX
letterbox to 640x640 with gray padding; RTMPose crops each person with 1.25x
padding to 192x256, normalizes, and decodes SimCC outputs.

Keypoints follow COCO-17 order.
"""
from __future__ import annotations

from dataclasses import dataclass, field
from typing import Protocol

import cv2
import numpy as np

from services import court_model as cm

NOSE, L_SHOULDER, R_SHOULDER, L_WRIST, R_WRIST, L_HIP, R_HIP, L_ANKLE, R_ANKLE = 0, 5, 6, 9, 10, 11, 12, 15, 16


@dataclass(eq=False)
class Person:
    box: np.ndarray                      # x1, y1, x2, y2 in pixels
    keypoints: np.ndarray | None = None  # (17, 2) pixels
    scores: np.ndarray | None = None     # (17,)
    court: tuple[float, float] | None = None   # feet position on court, meters

    @property
    def feet(self) -> np.ndarray:
        if self.keypoints is not None and self.scores is not None:
            ankles = [k for k in (L_ANKLE, R_ANKLE) if self.scores[k] > 0.3]
            if ankles:
                return self.keypoints[ankles].mean(axis=0)
        x1, y1, x2, y2 = self.box
        return np.array([(x1 + x2) / 2, y2])

    def point(self, idx: int, min_score: float = 0.3) -> np.ndarray | None:
        if self.keypoints is None or self.scores is None or self.scores[idx] < min_score:
            return None
        return self.keypoints[idx]

    @property
    def center_x(self) -> float:
        ls, rs = self.point(L_SHOULDER), self.point(R_SHOULDER)
        if ls is not None and rs is not None:
            return float((ls[0] + rs[0]) / 2)
        lh, rh = self.point(L_HIP), self.point(R_HIP)
        if lh is not None and rh is not None:
            return float((lh[0] + rh[0]) / 2)
        return float((self.box[0] + self.box[2]) / 2)

    @property
    def height_px(self) -> float:
        return float(self.box[3] - self.box[1])


class PeopleModel(Protocol):
    name: str

    def __call__(self, frame: np.ndarray) -> list[Person]:
        ...


@dataclass
class Players:
    near: Person | None = None
    far: Person | None = None
    others: list[Person] = field(default_factory=list)

    def side(self, side: str) -> Person | None:
        return self.near if side == "near" else self.far


def assign_players(people: list[Person], image_to_court: np.ndarray, frame_shape: tuple[int, int]) -> Players:
    """The player on each half is the biggest person standing in that half's play area."""
    h, w = frame_shape
    near: list[Person] = []
    far: list[Person] = []
    for p in people:
        fx, fy = p.feet
        x, y = cm.apply_homography(image_to_court, [(fx / w, fy / h)])[0]
        p.court = (float(x), float(y))
        if abs(x) > cm.DOUBLES_HALF_WIDTH + 4.0 or abs(y) > cm.HALF_LENGTH + 7.0:
            continue
        (far if y > 0 else near).append(p)
    pick = lambda group: max(group, key=lambda q: q.height_px) if group else None  # noqa: E731
    placed = {id(q) for q in near + far}
    return Players(near=pick(near), far=pick(far), others=[p for p in people if id(p) not in placed])


# ─── ONNX models ─────────────────────────────────────────────────────────────

class _Onnx:
    def __init__(self, path: str, threads: int | None = None):
        import onnxruntime as ort

        opts = ort.SessionOptions()
        if threads:
            opts.intra_op_num_threads = threads
        self.session = ort.InferenceSession(path, opts, providers=["CPUExecutionProvider"])
        self.input_name = self.session.get_inputs()[0].name

    def run(self, x: np.ndarray) -> list[np.ndarray]:
        return self.session.run(None, {self.input_name: x})


def _nms(boxes: np.ndarray, scores: np.ndarray, thr: float) -> list[int]:
    x1, y1, x2, y2 = boxes.T
    areas = (x2 - x1 + 1) * (y2 - y1 + 1)
    order = scores.argsort()[::-1]
    keep = []
    while order.size:
        i = order[0]
        keep.append(int(i))
        xx1 = np.maximum(x1[i], x1[order[1:]])
        yy1 = np.maximum(y1[i], y1[order[1:]])
        xx2 = np.minimum(x2[i], x2[order[1:]])
        yy2 = np.minimum(y2[i], y2[order[1:]])
        inter = np.maximum(0, xx2 - xx1 + 1) * np.maximum(0, yy2 - yy1 + 1)
        order = order[1:][inter / (areas[i] + areas[order[1:]] - inter) <= thr]
    return keep


class YoloxPeople:
    """YOLOX person detector exported by MMDeploy (rtmlib's 'onnx_sdk' builds)."""

    def __init__(self, path: str, input_hw: tuple[int, int] = (640, 640), score_thr: float = 0.5, threads=None):
        self.model = _Onnx(path, threads)
        self.input_hw = input_hw
        self.score_thr = score_thr

    def __call__(self, frame: np.ndarray) -> list[np.ndarray]:
        ih, iw = self.input_hw
        h, w = frame.shape[:2]
        ratio = min(ih / h, iw / w)
        padded = np.full((ih, iw, 3), 114, dtype=np.uint8)
        padded[: int(h * ratio), : int(w * ratio)] = cv2.resize(frame, (int(w * ratio), int(h * ratio)))
        x = np.ascontiguousarray(padded.transpose(2, 0, 1), dtype=np.float32)[None]
        out = self.model.run(x)[0]
        if out.shape[-1] == 5:                       # NMS inside the model: x1, y1, x2, y2, score
            dets = out[0]
            dets = dets[dets[:, 4] > self.score_thr]
            return [d[:4] / ratio for d in dets]
        # Raw YOLOX head: decode grids, then NMS on the person class.
        preds = out[0].copy()
        grids, strides = [], []
        for s in (8, 16, 32):
            gh, gw = ih // s, iw // s
            xv, yv = np.meshgrid(np.arange(gw), np.arange(gh))
            grids.append(np.stack((xv, yv), 2).reshape(-1, 2))
            strides.append(np.full((gh * gw, 1), s))
        grids = np.concatenate(grids)
        strides = np.concatenate(strides)
        preds[:, :2] = (preds[:, :2] + grids) * strides
        preds[:, 2:4] = np.exp(preds[:, 2:4]) * strides
        scores = preds[:, 4] * preds[:, 5]
        keep = scores > self.score_thr
        b = preds[keep, :4]
        boxes = np.stack([b[:, 0] - b[:, 2] / 2, b[:, 1] - b[:, 3] / 2, b[:, 0] + b[:, 2] / 2, b[:, 1] + b[:, 3] / 2], 1) / ratio
        return [boxes[i] for i in _nms(boxes, scores[keep], 0.45)] if len(boxes) else []


class RTMPose:
    """RTMPose-m body (COCO-17), SimCC head."""

    def __init__(self, path: str, input_wh: tuple[int, int] = (192, 256), threads=None):
        self.model = _Onnx(path, threads)
        self.input_wh = input_wh
        self.mean = np.array((123.675, 116.28, 103.53), dtype=np.float32)
        self.std = np.array((58.395, 57.12, 57.375), dtype=np.float32)

    def __call__(self, frame: np.ndarray, box: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        w, h = self.input_wh
        x1, y1, x2, y2 = box
        center = np.array([(x1 + x2) / 2, (y1 + y2) / 2], dtype=np.float32)
        scale = np.array([x2 - x1, y2 - y1], dtype=np.float32) * 1.25
        aspect = w / h
        if scale[0] > scale[1] * aspect:
            scale = np.array([scale[0], scale[0] / aspect], dtype=np.float32)
        else:
            scale = np.array([scale[1] * aspect, scale[1]], dtype=np.float32)
        src = np.float32([center, center + [0, -scale[0] * 0.5], center + [scale[0] * 0.5, -scale[0] * 0.5]])
        dst = np.float32([[w / 2, h / 2], [w / 2, h / 2 - w / 2], [w, h / 2 - w / 2]])
        warp = cv2.getAffineTransform(src, dst)
        crop = cv2.warpAffine(frame, warp, (w, h), flags=cv2.INTER_LINEAR).astype(np.float32)
        x = ((crop - self.mean) / self.std).transpose(2, 0, 1)[None].astype(np.float32)
        simcc_x, simcc_y = self.model.run(x)
        sx, sy = simcc_x[0], simcc_y[0]
        locs = np.stack([sx.argmax(1), sy.argmax(1)], 1).astype(np.float32) / 2.0
        scores = (sx.max(1) + sy.max(1)) / 2
        kpts = locs / np.array([w, h]) * scale + center - scale / 2
        return kpts, scores


class PoseModel:
    name = "yolox-m+rtmpose-m"

    def __init__(self, detector_path: str, pose_path: str, threads=None):
        self.detector = YoloxPeople(detector_path, threads=threads)
        self.pose = RTMPose(pose_path, threads=threads)

    def __call__(self, frame: np.ndarray) -> list[Person]:
        people = []
        for box in self.detector(frame):
            kpts, scores = self.pose(frame, box)
            people.append(Person(box=np.asarray(box, dtype=np.float32), keypoints=kpts, scores=scores))
        return people
