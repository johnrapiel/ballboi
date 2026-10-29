"""
End to end: a rendered synthetic match through the full pipeline, scored by the
eval harness. The detectors here are stand-ins (motion for the ball, color for
the players), so this proves the logic (court geometry, hits, bounces, shot
types, line calls, points), not real-world accuracy. That comes from the
labeled test set.
"""
import os
import sys

import cv2
import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
sys.path.insert(0, os.path.dirname(__file__))

import synthetic_match as sm  # noqa: E402
from evaluation import metrics  # noqa: E402
from evaluation.schema import parse_match  # noqa: E402
from services import court_model as cm  # noqa: E402
from services.pipeline.ball import MotionDetector  # noqa: E402
from services.pipeline.court import detect_court  # noqa: E402
from services.pipeline.models import Models  # noqa: E402
from services.pipeline.run import AnalysisError, analyze_match, to_prediction_file  # noqa: E402

BARS = {"shot_type": 0.90, "close_call_in_out": 0.85, "serve_placement": 0.85}


@pytest.fixture(scope="module")
def match(tmp_path_factory):
    scene = sm.build_scene()
    path = str(tmp_path_factory.mktemp("synthetic") / "match.avi")
    cam = sm.render(scene, path)
    label = sm.truth_label(scene, cam)
    result = analyze_match(path, calibration=label["calibrations"][0]["corners"],
                           models=Models(ball=MotionDetector(), people=sm.ColorPeople()))
    summary = metrics.summarize({"synthetic": parse_match(label)},
                                {"synthetic": parse_match(to_prediction_file(result, "synthetic"))}, BARS)
    return {"path": path, "cam": cam, "label": label, "result": result, "summary": summary}


def rate(summary, name):
    return summary.stats[name].rate


def test_finds_every_shot_and_hitter(match):
    s = match["summary"]
    assert rate(s, "shot_detection_recall") >= 11 / 12
    assert rate(s, "shot_detection_precision") >= 11 / 12
    assert rate(s, "hitter") == 1.0


def test_shot_types_serves_and_line_calls(match):
    s = match["summary"]
    assert rate(s, "shot_type") >= 0.9
    assert rate(s, "serve_placement") >= 0.75
    assert rate(s, "in_out") >= 0.9
    assert s.errors["landing_error_m"]["median"] < 0.6


def test_points_end_the_right_way(match):
    assert rate(match["summary"], "point_ending") >= 0.75
    points = match["result"]["points"]
    assert [p["ending"] for p in points][:1] == ["winner"]           # the ace
    assert all(p["rallyLength"] >= 1 for p in points)


def test_fault_then_second_serve(match):
    serves = [s for s in match["result"]["shots"] if s["type"] == "serve"]
    numbers = [(s["serveNumber"], s["result"]) for s in serves]
    assert (1, "out") in numbers and (2, "in") in numbers


def test_result_keeps_the_api_callback_fields(match):
    shot = match["result"]["shots"][0]
    for key in ("sequenceNumber", "rallyNumber", "timestampSeconds", "shotType", "shotTypeConfidence",
                "outcome", "courtZone", "contactPoint", "ballTrajectory", "playerPose", "rawMlData"):
        assert key in shot
    assert shot["courtZone"]["name"].startswith("service_box_")
    assert 0 <= shot["courtZone"]["x"] <= 1 and 0 <= shot["courtZone"]["y"] <= 1
    assert match["result"]["model"]["degraded"] is True              # stand-in models are flagged


def test_court_detection_without_phone_corners(match):
    cap = cv2.VideoCapture(match["path"])
    cap.set(cv2.CAP_PROP_POS_FRAMES, 100)
    ok, frame = cap.read()
    cap.release()
    assert ok
    fit = detect_court(frame)
    assert fit is not None and fit.confidence > 0.8
    truth = match["cam"].corners()
    worst_px = (np.abs(np.array(fit.corners) - np.array(truth)) * [sm.W, sm.H]).max()
    assert worst_px < 8
    for point in [(0.0, 6.4), (-2.0, -8.0), (3.0, 10.0)]:
        seen = cm.court_to_image(truth, point)
        assert np.allclose(cm.image_to_court(fit.corners, seen), point, atol=0.35)


def test_blank_video_fails_with_a_plain_message(tmp_path):
    path = str(tmp_path / "blank.avi")
    writer = cv2.VideoWriter(path, cv2.VideoWriter_fourcc(*"MJPG"), 30, (320, 180))
    for _ in range(30):
        writer.write(np.zeros((180, 320, 3), np.uint8))
    writer.release()
    with pytest.raises(AnalysisError, match="court"):
        analyze_match(path, models=Models(ball=MotionDetector(), people=None))
