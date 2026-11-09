"""
Court detection on a real court: John's first court test (Nov 8). Green hard
court, white tennis lines with pale yellow pickleball lines over them, seen
from behind the near baseline with the far baseline hidden behind the net.

The frames and hand-labeled corners are the phone's test fixtures
(artifacts/mobile/lib/__tests__/fixtures/court-frames), so the phone
(lib/court/detect.ts) and the server are held to the same frames.
"""
import json
import math
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import court_model as cm  # noqa: E402
from services.pipeline import court  # noqa: E402

FRAMES_DIR = os.path.join(os.path.dirname(__file__), "..", "..", "mobile", "lib", "__tests__", "fixtures", "court-frames")
pytestmark = pytest.mark.skipif(not os.path.isdir(FRAMES_DIR), reason="needs the phone's court test frames")


def _labels() -> dict:
    with open(os.path.join(FRAMES_DIR, "corners.json")) as f:
        return json.load(f)


def _frame(name: str) -> np.ndarray:
    img = cv2.imread(os.path.join(FRAMES_DIR, f"{name}.jpg"))
    assert img is not None
    return img


NAMES = sorted(_labels()) if os.path.isdir(FRAMES_DIR) else []


@pytest.mark.parametrize("name", NAMES)
def test_lands_on_the_labeled_corners(name):
    fit = court.detect_court(_frame(name))
    assert fit is not None
    assert fit.confidence >= 0.55
    c, lab = np.array(fit.corners), np.array(_labels()[name])
    err = np.hypot(c[:, 0] - lab[:, 0], (c[:, 1] - lab[:, 1]) * 9 / 16).max()
    assert err < 0.035


@pytest.mark.parametrize("name", NAMES[:4])
def test_pickleball_lines_are_not_court_paint(name):
    frame = _frame(name)
    lines = court._find_lines(frame, court.line_mask(frame), 270 * 0.07)
    white = court._white_level([l for l in lines if l.votes >= 270 * 0.12])
    pickleball = [((122, 163), (181, 127.5)), ((284, 131), (334, 175))]

    def on(l, seg):
        return all(abs(x * math.cos(l.theta) + y * math.sin(l.theta) - l.rho) < 8 for x, y in seg)

    for l in lines:
        if any(on(l, seg) for seg in pickleball):
            assert l.yellow > white + court.YELLOW_MARGIN


def test_degenerate_views_are_thrown_out():
    # What detection used to return on these frames: corners on top of each other, or one flung off the frame.
    old = [
        [[-634.2, 181.1], [483.9, 239.7], [208.4, 86.9], [207.5, 86.7]],
        [[144.2, 51.9], [4209, 2004.9], [156, 50.9], [138.7, 48.8]],
        [[225.7, 227.1], [453.8, 239.1], [20.1, 18.6], [16.7, 18.1]],
    ]
    views = np.array([cm.homography(cm.SINGLES_CORNERS_M, c) for c in old])
    assert not court._plausible(views, 480, 270).any()
    good = cm.homography(cm.SINGLES_CORNERS_M, np.array(_labels()["video-01"]) * [480, 270])
    assert court._plausible(good[None], 480, 270).all()


def test_a_sideways_still_finds_no_court():
    frame = cv2.rotate(_frame("video-01"), cv2.ROTATE_90_CLOCKWISE)
    fit = court.detect_court(frame)
    assert fit is None or fit.confidence < 0.55


# ─── Low light and shade ─────────────────────────────────────────────────────
# The same frames as if filmed later in the day or with the court partly in
# shade (the phone's "low light and shade" tests in courtFrames.test.ts).
# Before Nov 9 the paint rule wanted lines brighter than 120, so at 40%
# brightness, or with a shadow across the near court, it found nothing.

def _darker(frame: np.ndarray, gain: float) -> np.ndarray:
    return (frame.astype(np.float64) * gain).astype(np.uint8)


def _shaded(frame: np.ndarray) -> np.ndarray:
    """A shadow (40% light) over the near court, its edge running down from left to right."""
    h, w = frame.shape[:2]
    ys, xs = np.mgrid[0:h, 0:w]
    out = frame.astype(np.float64)
    out[ys >= 140 + xs * 60 / w] *= 0.4
    return out.astype(np.uint8)


def _err(fit, name) -> float:
    c, lab = np.array(fit.corners), np.array(_labels()[name])
    return float(np.hypot(c[:, 0] - lab[:, 0], (c[:, 1] - lab[:, 1]) * 9 / 16).max())


@pytest.mark.parametrize("name", NAMES)
def test_finds_the_court_in_shade(name):
    fit = court.detect_court(_shaded(_frame(name)))
    assert fit is not None and fit.confidence >= 0.55
    assert _err(fit, name) < 0.035


def test_finds_the_court_at_40_percent_brightness():
    found = 0
    for name in NAMES:
        fit = court.detect_court(_darker(_frame(name), 0.4))
        if fit is not None and fit.confidence >= 0.55 and _err(fit, name) < 0.035:
            found += 1
    assert found >= 10


def test_usual_rule_sees_no_paint_in_the_dark_and_low_light_rule_does():
    dim = _darker(_frame("video-05"), 0.4)
    assert (court.line_mask(dim) > 0).sum() < 500
    assert (court.line_mask(dim, low_light=True) > 0).sum() > 3000


def test_well_lit_frames_keep_the_usual_fit(monkeypatch):
    calls = []
    real = court._detect_small
    monkeypatch.setattr(court, "_detect_small", lambda f, low_light=False: calls.append(low_light) or real(f, low_light))
    for name in NAMES:
        calls.clear()
        fit = court.detect_court(_frame(name))
        if fit.confidence >= court.RETRY_BELOW:
            assert calls == [False]
