"""Reading match video frame by frame without holding the whole match in memory."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterator

import cv2
import numpy as np


@dataclass
class VideoInfo:
    fps: float
    frame_count: int
    width: int
    height: int

    @property
    def duration(self) -> float:
        return self.frame_count / self.fps if self.fps else 0.0


def video_info(path: str) -> VideoInfo:
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Can't open video: {path}")
    try:
        fps = cap.get(cv2.CAP_PROP_FPS) or 30.0
        if not np.isfinite(fps) or fps <= 1:
            fps = 30.0
        return VideoInfo(
            fps=float(fps),
            frame_count=int(cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0),
            width=int(cap.get(cv2.CAP_PROP_FRAME_WIDTH)),
            height=int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT)),
        )
    finally:
        cap.release()


def iter_frames(path: str, start: int = 0, end: int | None = None) -> Iterator[tuple[int, np.ndarray]]:
    """Yields (frame_index, BGR frame) in order."""
    cap = cv2.VideoCapture(path)
    if not cap.isOpened():
        raise ValueError(f"Can't open video: {path}")
    try:
        if start:
            cap.set(cv2.CAP_PROP_POS_FRAMES, start)
        index = start
        while end is None or index < end:
            ok, frame = cap.read()
            if not ok:
                break
            yield index, frame
            index += 1
    finally:
        cap.release()


def read_frames(path: str, indices: list[int]) -> dict[int, np.ndarray]:
    """Reads specific frames, seeking only when the next one isn't close ahead."""
    wanted = sorted(set(i for i in indices if i >= 0))
    out: dict[int, np.ndarray] = {}
    if not wanted:
        return out
    cap = cv2.VideoCapture(path)
    try:
        pos = -1
        for idx in wanted:
            if pos < 0 or idx < pos or idx - pos > 30:
                cap.set(cv2.CAP_PROP_POS_FRAMES, idx)
                pos = idx
            while pos < idx:
                cap.grab()
                pos += 1
            ok, frame = cap.read()
            pos += 1
            if ok:
                out[idx] = frame
    finally:
        cap.release()
    return out
