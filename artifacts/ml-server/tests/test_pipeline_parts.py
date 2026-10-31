"""Pipeline pieces in isolation: tracking, model wrappers, line calls, points, storage, versions."""
import datetime as dt
import json
import os
import sys

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services import court_model as cm  # noqa: E402
from services import storage  # noqa: E402
from services.pipeline import models as model_mod  # noqa: E402
from services.pipeline.ball import WASBDetector, track_ball  # noqa: E402
from services.pipeline.court import from_phone  # noqa: E402
from services.pipeline.events import Hit  # noqa: E402
from services.pipeline.players import RTMPose, YoloxPeople  # noqa: E402
from services.pipeline.shots import ShotOut, assign_points, call_line  # noqa: E402

CORNERS = [[0.18, 0.92], [0.82, 0.92], [0.63, 0.31], [0.37, 0.31]]


# ─── Tracking ────────────────────────────────────────────────────────────────

def test_tracking_fills_short_gaps_and_drops_outliers():
    cands = [[(10.0 * i, 100.0, 1.0)] for i in range(20)]
    cands[5] = []                                   # missed frame
    cands[6] = []
    cands[12] = [(10.0 * 12, 300.0, 0.5)]           # a stray detection far off the path
    track = track_ball(cands, frame_width=640)
    assert track.interpolated[5] and track.interpolated[6]
    assert track.xy[5] == pytest.approx((50.0, 100.0))
    assert np.isnan(track.xy[12, 0]) or abs(track.xy[12, 1] - 100.0) < 1e-6


def test_tracking_prefers_the_candidate_on_the_path():
    cands = [[(10.0 * i, 100.0, 1.0)] for i in range(5)]
    cands.append([(400.0, 50.0, 2.0), (50.0, 100.0, 1.0)])   # stronger decoy vs the real ball
    track = track_ball(cands, frame_width=640)
    assert track.xy[5] == pytest.approx((50.0, 100.0))


# ─── Model wrappers (fake ONNX sessions) ─────────────────────────────────────

class FakeOnnx:
    def __init__(self, outputs):
        self.outputs = outputs
        self.seen = None

    def run(self, x):
        self.seen = x
        return self.outputs


def test_wasb_pre_and_post_processing_map_back_to_the_frame():
    det = WASBDetector.__new__(WASBDetector)
    det.threshold = 0.5
    frames = [np.zeros((720, 1280, 3), np.uint8)] * 3
    x, inv = det.preprocess(frames)
    assert x.shape == (1, 9, 288, 512) and x.dtype == np.float32
    hm = np.full((3, 288, 512), -10.0, np.float32)
    hm[1, 100:103, 200:203] = 10.0                  # a blob centered at (201, 101) in model space
    cands = det.postprocess(hm, inv)
    assert cands[0] == [] and cands[2] == []
    x_px, y_px, _ = cands[1][0]
    assert x_px == pytest.approx(201 * 2.5, abs=0.5) and y_px == pytest.approx(101 * 2.5, abs=0.5)


def test_wasb_letterboxes_other_aspect_ratios():
    det = WASBDetector.__new__(WASBDetector)
    det.threshold = 0.5
    _, inv = det.preprocess([np.zeros((1080, 1080, 3), np.uint8)] * 3)
    hm = np.full((3, 288, 512), -10.0, np.float32)
    hm[0, 143:146, 255:258] = 10.0                  # model-space center (256, 144) = frame center
    x_px, y_px, _ = det.postprocess(hm, inv)[0][0]
    assert x_px == pytest.approx(540, abs=4) and y_px == pytest.approx(540, abs=4)


def test_yolox_with_built_in_nms_scales_boxes_back():
    people = YoloxPeople.__new__(YoloxPeople)
    people.input_hw = (640, 640)
    people.score_thr = 0.5
    people.model = FakeOnnx([np.array([[[64, 32, 128, 320, 0.9], [0, 0, 10, 10, 0.2]]], np.float32)])
    boxes = people(np.zeros((1080, 1920, 3), np.uint8))
    assert len(boxes) == 1
    assert boxes[0] == pytest.approx([64 * 3, 32 * 3, 128 * 3, 320 * 3])


def test_rtmpose_decodes_simcc_into_frame_pixels():
    pose = RTMPose.__new__(RTMPose)
    pose.input_wh = (192, 256)
    pose.mean = np.zeros(3, np.float32)
    pose.std = np.ones(3, np.float32)
    sx = np.zeros((1, 17, 384), np.float32)
    sy = np.zeros((1, 17, 512), np.float32)
    sx[0, :, 192] = 1.0                              # crop center
    sy[0, :, 256] = 1.0
    pose.model = FakeOnnx([sx, sy])
    box = np.array([100, 200, 160, 400], np.float32)
    kpts, scores = pose(np.zeros((720, 1280, 3), np.uint8), box)
    assert kpts[0] == pytest.approx((130, 300), abs=1.0)  # the box center
    assert scores[0] == pytest.approx(1.0)


# ─── Court corners from the phone ────────────────────────────────────────────

def test_phone_corners_in_both_shapes():
    assert from_phone(CORNERS).corners == CORNERS
    legacy = {"pointOrder": ["Near left baseline"], "points": [{"x": x, "y": y} for x, y in CORNERS]}
    assert from_phone(legacy).corners == CORNERS
    assert from_phone([[0, 0], [1, 0], [0, 1]]) is None
    assert from_phone([[0, 0], [1, 1], [1, 0], [0, 1]]) is None   # crossed, not a court


# ─── Line calls ──────────────────────────────────────────────────────────────

def _hit(court, side="near", own=False):
    img = cm.court_to_image(CORNERS, court)
    return Hit(frame=0, side=side, bounce_frame=10, bounce_court=court, bounce_image=img, landed_on_own_side=own)


def test_clear_calls_are_confident_close_ones_flagged():
    h = cm.image_to_court_matrix(CORNERS)
    result, conf, close, d = call_line(_hit((0.0, 6.0)), False, h, (1080, 1920))
    assert (result, close) == ("in", False) and conf > 0.99
    result, conf, close, d = call_line(_hit((4.15, 10.5)), False, h, (1080, 1920))
    assert result == "out" and close and d == pytest.approx(-0.035, abs=1e-3)
    assert call_line(_hit((0.0, -2.0), own=True), False, h, (1080, 1920))[0] == "net"


def test_close_call_band_widens_with_distance_from_camera():
    h = cm.image_to_court_matrix(CORNERS)
    # 30 cm wide on a 640x360 frame: too fine to call at the far baseline, plain at the near one.
    assert call_line(_hit((4.415, 11.0), side="near"), False, h, (360, 640))[2] is True
    assert call_line(_hit((4.415, -6.0), side="far"), False, h, (1080, 1920))[2] is False


# ─── Points ──────────────────────────────────────────────────────────────────

def _shot(rally, side, kind, result, speed=None, line=None):
    return ShotOut(hit=Hit(frame=0, side=side, rally=rally), time=0.0, type=kind, type_confidence=1.0,
                   result=result, result_confidence=1.0, close_call=False, line_distance=line, speed_mph=speed)


def test_double_fault_and_ace():
    shots = [_shot(0, "near", "serve", "out"), _shot(1, "near", "serve", "net"),
             _shot(2, "far", "serve", "in")]
    assign_points(shots)
    assert [s.serve_number for s in shots] == [1, 2, 1]
    assert [s.point_end for s in shots] == [None, "unforced_error", "winner"]


def test_forced_error_after_a_fast_or_deep_shot():
    shots = [_shot(0, "near", "serve", "in", speed=60), _shot(0, "far", "forehand", "in", speed=40, line=0.4),
             _shot(0, "near", "backhand", "out", speed=30),
             _shot(1, "far", "serve", "in", speed=50), _shot(1, "near", "forehand", "in", speed=20, line=3.0),
             _shot(1, "far", "forehand", "net", speed=25)]
    assign_points(shots)
    assert shots[2].point_end == "forced_error"
    assert shots[5].point_end == "unforced_error"


# ─── Storage ─────────────────────────────────────────────────────────────────

CFG = storage.S3Config("ballboi", "AKIDEXAMPLE", "wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY", "auto",
                       "https://acct123.r2.cloudflarestorage.com")
NOW = dt.datetime(2026, 10, 29, 12, 0, 0, tzinfo=dt.timezone.utc)


def test_presigned_get_matches_botocore():
    # Reference signatures generated with botocore (path-style, s3v4) for the same inputs.
    url = storage.presign(CFG, storage.object_key("/objects/uploads/match 1.mp4"), now=NOW)
    assert url.startswith("https://acct123.r2.cloudflarestorage.com/ballboi/uploads/match%201.mp4?")
    assert url.endswith("X-Amz-Signature=b421fa8d69d779be0a528a52fb7029983e3b7acb91102f7e61a68d10736bf600")


def test_presigned_list_matches_botocore():
    url = storage.presign(CFG, "", query={"list-type": "2", "prefix": "test-set/", "encoding-type": "url"}, now=NOW)
    assert url.endswith("X-Amz-Signature=8b93c9b546e9d6be37cd22dd7207c09512d0588835ef47ada122974dc9c14326")


def test_storage_needs_settings(monkeypatch):
    for k in ("S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"):
        monkeypatch.delenv(k, raising=False)
    with pytest.raises(storage.StorageNotConfigured):
        storage.S3Config.from_env()


# ─── Models and versions ─────────────────────────────────────────────────────

def test_missing_models_refuse_unless_fallback_allowed(tmp_path):
    with pytest.raises(model_mod.ModelsMissing, match="aren't installed"):
        model_mod.load_models(tmp_path)
    m = model_mod.load_models(tmp_path, allow_fallback=True)
    assert m.degraded and m.describe()["ball"] == "motion"


def test_version_changes_with_model_files(tmp_path):
    a = tmp_path / "a.onnx"
    a.write_bytes(b"one")
    v1 = model_mod.pipeline_version({"ball": a})
    a.write_bytes(b"two")
    assert model_mod.pipeline_version({"ball": a}) != v1
    assert model_mod.pipeline_version() == model_mod.pipeline_version()


def test_latest_eval_report_matches_the_pipeline():
    """Every model change is scored: a committed report must come from the current pipeline code."""
    report = os.path.join(os.path.dirname(__file__), "..", "evaluation", "reports", "latest", "report.json")
    if not os.path.exists(report):
        pytest.skip("No eval report yet: it starts once the test set is labeled.")
    model = json.load(open(report)).get("model", {})
    assert model.get("sourceVersion") == model_mod.pipeline_version(), (
        "The pipeline changed since the last eval. Run: python -m evaluation run --videos <folder>, "
        "then commit evaluation/reports/latest."
    )


def test_court_fit_rejects_collapsed_corners():
    """The first real upload produced a 'court' with two corners on the same point, at 99.5% confidence."""
    from services.pipeline.court import _plausible
    w, h = 960, 540
    bad = [[0.4878668, 0.4051597], [0.8990429, 0.6719812], [0.9387246, 0.5218851], [0.4878638, 0.4051527]]
    to_px = [[x * w, y * h] for x, y in bad]
    assert not _plausible(cm.homography(cm.SINGLES_CORNERS_M, to_px), (h, w))
    good = [[x * w, y * h] for x, y in CORNERS]
    assert _plausible(cm.homography(cm.SINGLES_CORNERS_M, good), (h, w))
