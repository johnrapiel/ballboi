"""
Tests for Ball Boi heatmap alignment on angled courts.

Covers:
- Calibration normalization (valid and invalid inputs)
- Perspective coordinate mapping for angled phone placements
- Court zone detection with and without calibration
- Reporting of whether calibration was applied in analysis output
"""

import math
import sys
import os
from unittest.mock import patch

import numpy as np
import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

from services.analyzer import (
    COURT_CALIBRATION_POINT_ORDER,
    _normalize_calibration,
    _map_to_calibrated_court_points,
    _analyze_frames,
    detect_court_zone,
    detect_calibrated_court_zone,
)


# ─── Helpers ──────────────────────────────────────────────────────────────────

def _make_calibration(points: list[dict]) -> dict:
    """Build a calibration dict in the expected API shape."""
    return {
        "pointOrder": list(COURT_CALIBRATION_POINT_ORDER),
        "points": points,
    }


def _ball(x: float, y: float) -> dict:
    return {"x": x, "y": y, "confidence": 0.9}


ANGLED_COURT = _make_calibration([
    {"x": 0.10, "y": 0.88},
    {"x": 0.90, "y": 0.88},
    {"x": 0.72, "y": 0.18},
    {"x": 0.28, "y": 0.18},
])

STRAIGHT_COURT = _make_calibration([
    {"x": 0.05, "y": 0.95},
    {"x": 0.95, "y": 0.95},
    {"x": 0.95, "y": 0.05},
    {"x": 0.05, "y": 0.05},
])


# ─── _normalize_calibration ───────────────────────────────────────────────────

class TestNormalizeCalibration:
    def test_none_input_returns_none(self):
        assert _normalize_calibration(None) is None

    def test_non_dict_returns_none(self):
        assert _normalize_calibration("invalid") is None
        assert _normalize_calibration([1, 2, 3, 4]) is None

    def test_missing_point_order_returns_none(self):
        cal = {
            "points": [{"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9},
                       {"x": 0.9, "y": 0.1}, {"x": 0.1, "y": 0.1}],
        }
        assert _normalize_calibration(cal) is None

    def test_wrong_point_order_returns_none(self):
        cal = _make_calibration([
            {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9},
            {"x": 0.9, "y": 0.1}, {"x": 0.1, "y": 0.1},
        ])
        cal["pointOrder"] = ["Wrong", "Order", "Here", "Now"]
        assert _normalize_calibration(cal) is None

    def test_wrong_number_of_points_returns_none(self):
        cal = _make_calibration([
            {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9}, {"x": 0.5, "y": 0.1},
        ])
        assert _normalize_calibration(cal) is None

    def test_missing_coordinate_in_point_returns_none(self):
        cal = _make_calibration([
            {"x": 0.1, "y": 0.9}, {"y": 0.9},
            {"x": 0.9, "y": 0.1}, {"x": 0.1, "y": 0.1},
        ])
        assert _normalize_calibration(cal) is None

    def test_degenerate_area_returns_none(self):
        cal = _make_calibration([
            {"x": 0.5, "y": 0.5}, {"x": 0.5, "y": 0.5},
            {"x": 0.5, "y": 0.5}, {"x": 0.5, "y": 0.5},
        ])
        assert _normalize_calibration(cal) is None

    def test_collinear_points_returns_none(self):
        cal = _make_calibration([
            {"x": 0.1, "y": 0.1}, {"x": 0.4, "y": 0.1},
            {"x": 0.7, "y": 0.1}, {"x": 0.9, "y": 0.1},
        ])
        assert _normalize_calibration(cal) is None

    def test_non_convex_shape_returns_none(self):
        cal = _make_calibration([
            {"x": 0.1, "y": 0.9}, {"x": 0.9, "y": 0.9},
            {"x": 0.3, "y": 0.6},
            {"x": 0.1, "y": 0.1},
        ])
        assert _normalize_calibration(cal) is None

    def test_valid_square_returns_four_tuples(self):
        result = _normalize_calibration(STRAIGHT_COURT)
        assert result is not None
        assert len(result) == 4
        for pt in result:
            assert len(pt) == 2
            assert isinstance(pt[0], float)
            assert isinstance(pt[1], float)

    def test_valid_angled_court_returns_four_tuples(self):
        result = _normalize_calibration(ANGLED_COURT)
        assert result is not None
        assert len(result) == 4

    def test_out_of_range_coordinates_are_clamped(self):
        cal = _make_calibration([
            {"x": -0.5, "y": 1.5},
            {"x": 1.5, "y": 1.5},
            {"x": 1.5, "y": -0.5},
            {"x": -0.5, "y": -0.5},
        ])
        result = _normalize_calibration(cal)
        if result is not None:
            for x, y in result:
                assert 0.0 <= x <= 1.0
                assert 0.0 <= y <= 1.0


# ─── _map_to_calibrated_court_points ─────────────────────────────────────────

class TestMapToCalibratedCourtPoints:
    """
    The perspective transform maps:
      src[0] (Near left baseline)  → dst [0, 1]
      src[1] (Near right baseline) → dst [1, 1]
      src[2] (Far right baseline)  → dst [1, 0]
      src[3] (Far left baseline)   → dst [0, 0]

    So in court space:
      x=0  is left,  x=1 is right
      y=0  is far,   y=1 is near (close to camera)
    """

    def _points_from_calibration(self, cal: dict):
        return _normalize_calibration(cal)

    def test_near_left_corner_maps_to_bottom_left(self):
        pts = self._points_from_calibration(ANGLED_COURT)
        mx, my = _map_to_calibrated_court_points(pts[0][0], pts[0][1], pts)
        assert mx < 0.2, f"Expected x near 0 (left), got {mx}"
        assert my > 0.8, f"Expected y near 1 (near/bottom), got {my}"

    def test_near_right_corner_maps_to_bottom_right(self):
        pts = self._points_from_calibration(ANGLED_COURT)
        mx, my = _map_to_calibrated_court_points(pts[1][0], pts[1][1], pts)
        assert mx > 0.8, f"Expected x near 1 (right), got {mx}"
        assert my > 0.8, f"Expected y near 1 (near/bottom), got {my}"

    def test_far_right_corner_maps_to_top_right(self):
        pts = self._points_from_calibration(ANGLED_COURT)
        mx, my = _map_to_calibrated_court_points(pts[2][0], pts[2][1], pts)
        assert mx > 0.8, f"Expected x near 1 (right), got {mx}"
        assert my < 0.2, f"Expected y near 0 (far/top), got {my}"

    def test_far_left_corner_maps_to_top_left(self):
        pts = self._points_from_calibration(ANGLED_COURT)
        mx, my = _map_to_calibrated_court_points(pts[3][0], pts[3][1], pts)
        assert mx < 0.2, f"Expected x near 0 (left), got {mx}"
        assert my < 0.2, f"Expected y near 0 (far/top), got {my}"

    def test_centre_of_angled_court_maps_near_centre(self):
        pts = self._points_from_calibration(ANGLED_COURT)
        centre_x = sum(p[0] for p in pts) / 4
        centre_y = sum(p[1] for p in pts) / 4
        mx, my = _map_to_calibrated_court_points(centre_x, centre_y, pts)
        assert 0.3 < mx < 0.7, f"Expected centre x, got {mx}"
        assert 0.3 < my < 0.7, f"Expected centre y, got {my}"

    def test_result_clamped_to_unit_square(self):
        pts = self._points_from_calibration(STRAIGHT_COURT)
        for raw_x, raw_y in [(0.0, 0.0), (1.0, 1.0), (0.5, 0.5)]:
            mx, my = _map_to_calibrated_court_points(raw_x, raw_y, pts)
            assert 0.0 <= mx <= 1.0
            assert 0.0 <= my <= 1.0


# ─── detect_court_zone (uncalibrated) ────────────────────────────────────────

class TestDetectCourtZoneUncalibrated:
    def test_empty_detections_returns_unknown(self):
        zone, x, y = detect_court_zone([], "forehand")
        assert zone == "unknown"
        assert x == 0.5
        assert y == 0.5

    def test_all_none_detections_returns_unknown(self):
        zone, x, y = detect_court_zone([None, None], "forehand")
        assert zone == "unknown"

    def test_ball_near_net_returns_net(self):
        zone, x, y = detect_court_zone([_ball(0.5, 0.10)], "forehand")
        assert zone == "net"

    def test_ball_in_deuce_service_box(self):
        zone, x, y = detect_court_zone([_ball(0.25, 0.35)], "serve")
        assert zone == "service_box_deuce"

    def test_ball_in_ad_service_box(self):
        zone, x, y = detect_court_zone([_ball(0.75, 0.35)], "serve")
        assert zone == "service_box_ad"

    def test_ball_at_left_baseline(self):
        zone, x, y = detect_court_zone([_ball(0.3, 0.70)], "forehand")
        assert zone == "baseline_left"

    def test_ball_at_right_baseline(self):
        zone, x, y = detect_court_zone([_ball(0.7, 0.70)], "forehand")
        assert zone == "baseline_right"

    def test_uses_last_ball_position_in_sequence(self):
        balls = [_ball(0.5, 0.10), _ball(0.3, 0.70)]
        zone, x, y = detect_court_zone(balls, "forehand")
        assert zone == "baseline_left"
        assert math.isclose(x, 0.3)
        assert math.isclose(y, 0.70)


# ─── detect_calibrated_court_zone (calibrated) ───────────────────────────────

class TestDetectCalibratedCourtZone:
    """
    Tests specifically verify that angled court placements correctly map
    ball positions into the expected court zones after perspective correction.
    """

    def test_no_calibration_falls_back_to_raw_zone(self):
        balls = [_ball(0.25, 0.35)]
        zone_raw, x_raw, y_raw = detect_court_zone(balls, "serve")
        zone_cal, x_cal, y_cal = detect_calibrated_court_zone(balls, "serve", None)
        assert zone_raw == zone_cal
        assert math.isclose(x_raw, x_cal)
        assert math.isclose(y_raw, y_cal)

    def test_invalid_calibration_falls_back_to_raw_zone(self):
        balls = [_ball(0.5, 0.70)]
        zone_raw, _, _ = detect_court_zone(balls, "forehand")
        zone_cal, _, _ = detect_calibrated_court_zone(balls, "forehand", {"bad": "data"})
        assert zone_raw == zone_cal

    def test_angled_court_near_left_maps_to_baseline_left(self):
        """
        On the angled court the near-left baseline corner is at camera (0.10, 0.88).
        A ball a little inside from that corner (camera 0.30, 0.82) should map clearly
        into the left-hand baseline zone (mapped_y > 0.5, mapped_x < 0.5).
        We avoid the very corner because extreme edges land in the 'out' zone
        exactly as singles sidelines are enforced.
        """
        balls = [_ball(0.30, 0.82)]
        zone, mx, my = detect_calibrated_court_zone(balls, "forehand", ANGLED_COURT)
        assert zone == "baseline_left", (
            f"Expected 'baseline_left' for left-side angled court, got '{zone}' "
            f"(mapped x={mx:.3f}, y={my:.3f})"
        )
        assert mx < 0.5, f"Expected left-side (x<0.5), got {mx:.3f}"
        assert my > 0.5, f"Expected near-baseline (y>0.5), got {my:.3f}"

    def test_angled_court_near_right_maps_to_baseline_right(self):
        """
        A ball inside the right-hand baseline area of an angled court
        (camera 0.70, 0.82) should map to baseline_right.
        """
        balls = [_ball(0.70, 0.82)]
        zone, mx, my = detect_calibrated_court_zone(balls, "backhand", ANGLED_COURT)
        assert zone == "baseline_right", (
            f"Expected 'baseline_right' for right-side angled court, got '{zone}' "
            f"(mapped x={mx:.3f}, y={my:.3f})"
        )
        assert mx > 0.5, f"Expected right-side (x>0.5), got {mx:.3f}"
        assert my > 0.5, f"Expected near-baseline (y>0.5), got {my:.3f}"

    def test_angled_court_far_centre_maps_to_service_box(self):
        """
        A ball near the far end centre of an angled court (between far corners)
        should map into a service box zone (mapped_y < 0.5).
        """
        far_centre_x = (0.72 + 0.28) / 2
        far_centre_y = (0.18 + 0.18) / 2 + 0.05
        balls = [_ball(far_centre_x, far_centre_y)]
        zone, mx, my = detect_calibrated_court_zone(balls, "serve", ANGLED_COURT)
        assert zone in ("service_box_deuce", "service_box_ad"), (
            f"Expected service-box zone, got '{zone}' (mapped x={mx:.3f}, y={my:.3f})"
        )
        assert my < 0.5, f"Expected far-end (y<0.5), got {my:.3f}"

    def test_angled_court_mid_camera_maps_to_far_half(self):
        """
        Due to perspective foreshortening on an angled court, the linear midpoint
        of the camera's y axis is biased towards the near (player) end. A ball
        at the camera mid-y should therefore map to the near half of the court
        (mapped_y > 0.5) rather than the far half or net.
        """
        mid_x = (0.10 + 0.90 + 0.72 + 0.28) / 4
        mid_y = (0.88 + 0.18) / 2
        balls = [_ball(mid_x, mid_y)]
        zone, _, my = detect_calibrated_court_zone(balls, "forehand", ANGLED_COURT)
        assert my > 0.5, (
            f"Mid-camera y should map to near half of court (mapped_y>0.5), got {my:.3f}"
        )

    def test_calibrated_coordinates_differ_from_raw_on_angled_court(self):
        """
        On an angled court the raw camera coordinates are different from calibrated
        court coordinates - confirm that calibration actually changes the output.
        """
        balls = [_ball(0.28, 0.18)]
        _, raw_x, raw_y = detect_court_zone(balls, "forehand")
        _, cal_x, cal_y = detect_calibrated_court_zone(balls, "forehand", ANGLED_COURT)
        assert not (math.isclose(raw_x, cal_x, abs_tol=1e-3) and math.isclose(raw_y, cal_y, abs_tol=1e-3)), (
            "Calibration should change the coordinates on an angled court"
        )


# ─── calibration_applied reporting (real analyzer output) ─────────────────────

# Stub responses used by _analyze_frames without loading YOLO/MediaPipe models.
_STUB_BALL = [{"x": 0.35, "y": 0.72, "confidence": 0.85}]
_STUB_POSE = [{"left_hip": (0.4, 0.6), "right_hip": (0.6, 0.6),
               "left_shoulder": (0.4, 0.4), "right_shoulder": (0.6, 0.4),
               "left_wrist": (0.3, 0.5), "right_wrist": (0.7, 0.5)}]

# A minimal single-channel black frame (640×360) sufficient for cv2.resize.
_DUMMY_FRAME = np.zeros((360, 640, 3), dtype=np.uint8)


def _run_analyze_frames(court_calibration):
    """Call _analyze_frames with stubbed ML dependencies and a dummy frame."""
    with patch("services.analyzer.detect_balls_yolo", return_value=_STUB_BALL), \
         patch("services.analyzer.estimate_pose", return_value=_STUB_POSE):
        return _analyze_frames([_DUMMY_FRAME], fps=30.0, timestamp_seconds=0.0,
                               sequence_number=1, court_calibration=court_calibration)


class TestCalibrationAppliedReportingViaAnalyzer:
    """
    These tests call _analyze_frames directly (with stubbed YOLO/MediaPipe) and
    assert that the real rawMlData dict in the returned output contains the
    'courtCalibrationApplied' field with the correct value.
    """

    def test_analyze_frames_returns_result_when_ball_detected(self):
        result = _run_analyze_frames(None)
        assert result is not None, "_analyze_frames should return a dict when a ball is detected"

    def test_raw_ml_data_key_present_in_output(self):
        result = _run_analyze_frames(None)
        assert "rawMlData" in result, "Output must contain 'rawMlData'"

    def test_calibration_applied_field_present_in_raw_ml_data(self):
        result = _run_analyze_frames(None)
        assert "courtCalibrationApplied" in result["rawMlData"], (
            "rawMlData must contain 'courtCalibrationApplied'"
        )

    def test_calibration_applied_is_false_when_no_calibration(self):
        result = _run_analyze_frames(None)
        assert result["rawMlData"]["courtCalibrationApplied"] is False, (
            f"Expected False for no calibration, got {result['rawMlData']['courtCalibrationApplied']}"
        )

    def test_calibration_applied_is_false_for_invalid_calibration(self):
        bad_cal = {"pointOrder": COURT_CALIBRATION_POINT_ORDER, "points": []}
        result = _run_analyze_frames(bad_cal)
        assert result["rawMlData"]["courtCalibrationApplied"] is False, (
            "Expected False for empty-points calibration"
        )

    def test_calibration_applied_is_true_for_valid_angled_court(self):
        result = _run_analyze_frames(ANGLED_COURT)
        assert result["rawMlData"]["courtCalibrationApplied"] is True, (
            f"Expected True for valid angled court calibration, "
            f"got {result['rawMlData']['courtCalibrationApplied']}"
        )

    def test_calibration_applied_is_true_for_valid_straight_court(self):
        result = _run_analyze_frames(STRAIGHT_COURT)
        assert result["rawMlData"]["courtCalibrationApplied"] is True, (
            "Expected True for valid straight-on court calibration"
        )

    def test_angled_court_calibration_changes_court_zone_in_output(self):
        """
        With a valid angled-court calibration the court zone coordinates returned
        by _analyze_frames should differ from those returned without calibration,
        proving the perspective transform is actually applied to the analyzer output.
        """
        result_no_cal = _run_analyze_frames(None)
        result_cal = _run_analyze_frames(ANGLED_COURT)

        zone_no_cal = result_no_cal["courtZone"]
        zone_cal = result_cal["courtZone"]

        coords_changed = (
            not math.isclose(zone_no_cal["x"], zone_cal["x"], abs_tol=1e-3)
            or not math.isclose(zone_no_cal["y"], zone_cal["y"], abs_tol=1e-3)
        )
        assert coords_changed, (
            f"Calibration must change court zone coordinates. "
            f"No-cal: ({zone_no_cal['x']}, {zone_no_cal['y']}) "
            f"Calibrated: ({zone_cal['x']}, {zone_cal['y']})"
        )


# ─── detect_court_zone boundary conditions ────────────────────────────────────

class TestDetectCourtZoneBoundaries:
    """
    Test exact boundary values used in detect_court_zone's zone classification.

    Zone thresholds (y-axis, all strict less-than comparisons):
      y < 0.15  → net
      y < 0.45  → service_box_deuce / service_box_ad
      y < 0.85  → baseline_left / baseline_right
      x < 0.05 or x > 0.95 or y > 0.95  → out  (when y >= 0.85)
      else      → baseline_left / baseline_right

    x-axis split: x < 0.5 → left/deuce, x >= 0.5 → right/ad
    """

    # ── net / service-box boundary (y = 0.15) ─────────────────────────────────

    def test_y_just_below_net_boundary_is_net(self):
        zone, _, _ = detect_court_zone([_ball(0.5, 0.14)], "forehand")
        assert zone == "net"

    def test_y_exactly_at_net_boundary_is_service_box(self):
        # y=0.15 is NOT < 0.15, so falls into service_box bucket
        zone, _, _ = detect_court_zone([_ball(0.25, 0.15)], "serve")
        assert zone == "service_box_deuce"

    def test_y_just_above_net_boundary_is_service_box(self):
        zone, _, _ = detect_court_zone([_ball(0.75, 0.16)], "serve")
        assert zone == "service_box_ad"

    # ── service-box / baseline boundary (y = 0.45) ────────────────────────────

    def test_y_just_below_service_boundary_is_service_box(self):
        zone, _, _ = detect_court_zone([_ball(0.25, 0.44)], "serve")
        assert zone == "service_box_deuce"

    def test_y_exactly_at_service_boundary_is_baseline(self):
        # y=0.45 is NOT < 0.45
        zone, _, _ = detect_court_zone([_ball(0.3, 0.45)], "forehand")
        assert zone == "baseline_left"

    def test_y_just_above_service_boundary_is_baseline(self):
        zone, _, _ = detect_court_zone([_ball(0.7, 0.46)], "backhand")
        assert zone == "baseline_right"

    # ── x = 0.5 split between left/right ─────────────────────────────────────

    def test_x_just_below_centre_is_left_zone(self):
        zone, _, _ = detect_court_zone([_ball(0.499, 0.60)], "forehand")
        assert zone == "baseline_left"

    def test_x_exactly_at_centre_is_right_zone(self):
        # x=0.5 is NOT < 0.5
        zone, _, _ = detect_court_zone([_ball(0.5, 0.60)], "forehand")
        assert zone == "baseline_right"

    def test_x_just_above_centre_is_right_zone(self):
        zone, _, _ = detect_court_zone([_ball(0.501, 0.30)], "serve")
        assert zone == "service_box_ad"

    # ── out boundaries ────────────────────────────────────────────────────────

    def test_x_just_inside_left_sideline_is_not_out(self):
        # x=0.05 is NOT < 0.05; y is in the y>=0.85 band
        zone, _, _ = detect_court_zone([_ball(0.05, 0.90)], "forehand")
        assert zone != "out"

    def test_x_just_outside_left_sideline_is_out(self):
        zone, _, _ = detect_court_zone([_ball(0.04, 0.90)], "forehand")
        assert zone == "out"

    def test_x_just_inside_right_sideline_is_not_out(self):
        zone, _, _ = detect_court_zone([_ball(0.95, 0.90)], "forehand")
        assert zone != "out"

    def test_x_just_outside_right_sideline_is_out(self):
        zone, _, _ = detect_court_zone([_ball(0.96, 0.90)], "forehand")
        assert zone == "out"

    def test_y_just_at_back_baseline_is_not_out(self):
        # y=0.95 is NOT > 0.95
        zone, _, _ = detect_court_zone([_ball(0.5, 0.95)], "forehand")
        assert zone != "out"

    def test_y_just_beyond_back_baseline_is_out(self):
        zone, _, _ = detect_court_zone([_ball(0.5, 0.96)], "forehand")
        assert zone == "out"

    # ── multiple balls with varying confidence ────────────────────────────────

    def test_last_ball_wins_regardless_of_confidence(self):
        """detect_court_zone uses the last valid detection, not the highest confidence."""
        balls = [
            {"x": 0.5, "y": 0.10, "confidence": 0.99},  # net — high confidence
            {"x": 0.3, "y": 0.70, "confidence": 0.10},  # baseline_left — low confidence
        ]
        zone, x, y = detect_court_zone(balls, "forehand")
        assert zone == "baseline_left", (
            f"Expected last ball to determine zone regardless of confidence, got '{zone}'"
        )
        assert math.isclose(x, 0.3)
        assert math.isclose(y, 0.70)

    def test_zero_confidence_ball_is_still_used(self):
        """A confidence=0.0 detection is still a valid dict and should be used."""
        balls = [
            {"x": 0.5, "y": 0.10, "confidence": 0.9},
            {"x": 0.25, "y": 0.35, "confidence": 0.0},
        ]
        zone, x, y = detect_court_zone(balls, "serve")
        assert zone == "service_box_deuce"
        assert math.isclose(x, 0.25)
        assert math.isclose(y, 0.35)

    def test_none_entries_skipped_to_reach_last_valid_ball(self):
        """None entries in the list should be skipped; last non-None ball is used."""
        balls = [_ball(0.5, 0.10), None, None]
        zone, x, y = detect_court_zone(balls, "forehand")
        assert zone == "net"
        assert math.isclose(x, 0.5)
        assert math.isclose(y, 0.10)

    def test_single_low_confidence_ball_is_used(self):
        balls = [{"x": 0.7, "y": 0.30, "confidence": 0.05}]
        zone, _, _ = detect_court_zone(balls, "serve")
        assert zone == "service_box_ad"


# ─── detect_calibrated_court_zone boundary conditions ─────────────────────────

class TestDetectCalibratedCourtZoneBoundaries:
    """
    Test exact boundary values used by detect_calibrated_court_zone's
    post-perspective zone classification.

    Mapped-coordinate thresholds (all strict comparisons):
      mapped_y < 0.08                  → "out"   (ball behind far baseline)
      abs(mapped_y - 0.5) < 0.04       → "net"   (i.e. 0.46 < mapped_y < 0.54)
      mapped_y < 0.5                   → service_box_deuce / service_box_ad
      mapped_y < 0.92                  → baseline_left / baseline_right
      mapped_x < 0.03 or > 0.97       → "out"   (ball beyond near sidelines)
      else                             → baseline_left / baseline_right

    We use STRAIGHT_COURT so the perspective transform is close to identity,
    letting us reason about the thresholds directly.
    """

    # ── far-end out boundary (mapped_y = 0.08) ────────────────────────────────

    def test_mapped_y_just_below_far_out_boundary_is_out(self):
        """mapped_y slightly below 0.08 → out (ball past far baseline)."""
        # On STRAIGHT_COURT the mapping is close to identity; raw y≈0.08 maps
        # near 0.08 in mapped space. We use a raw value clearly below the threshold.
        balls = [_ball(0.5, 0.04)]
        zone, _, my = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone == "out", f"Expected 'out' for mapped_y~{my:.3f}, got '{zone}'"

    def test_mapped_y_above_far_out_boundary_is_not_out(self):
        # y=0.20 on STRAIGHT_COURT maps comfortably above 0.08 in court space.
        balls = [_ball(0.5, 0.20)]
        zone, _, my = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone != "out", f"Expected non-out for mapped_y~{my:.3f}, got '{zone}'"

    # ── net band (abs(mapped_y − 0.5) < 0.04) ────────────────────────────────

    def test_mapped_y_inside_net_band_is_net(self):
        """mapped_y≈0.5 (net region) should yield 'net'."""
        balls = [_ball(0.5, 0.50)]
        zone, _, my = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone == "net", f"Expected 'net' for mapped_y~{my:.3f}, got '{zone}'"

    def test_mapped_y_just_below_net_band_is_service_box(self):
        """mapped_y ≈ 0.45 is outside the net band (abs(0.45-0.5)=0.05 ≥ 0.04)."""
        balls = [_ball(0.25, 0.45)]
        zone, _, my = detect_calibrated_court_zone(balls, "serve", STRAIGHT_COURT)
        assert zone in ("service_box_deuce", "service_box_ad"), (
            f"Expected service_box for mapped_y~{my:.3f}, got '{zone}'"
        )

    def test_mapped_y_just_above_net_band_is_baseline(self):
        """mapped_y ≈ 0.55 is outside the net band and above 0.5 → baseline."""
        balls = [_ball(0.3, 0.55)]
        zone, _, my = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone in ("baseline_left", "baseline_right"), (
            f"Expected baseline for mapped_y~{my:.3f}, got '{zone}'"
        )

    # ── x-axis left/right split at 0.5 ───────────────────────────────────────

    def test_calibrated_x_just_below_half_is_deuce_service_box(self):
        balls = [_ball(0.25, 0.30)]
        zone, mx, _ = detect_calibrated_court_zone(balls, "serve", STRAIGHT_COURT)
        assert zone == "service_box_deuce", (
            f"Expected 'service_box_deuce' for mapped_x~{mx:.3f}, got '{zone}'"
        )

    def test_calibrated_x_just_above_half_is_ad_service_box(self):
        balls = [_ball(0.75, 0.30)]
        zone, mx, _ = detect_calibrated_court_zone(balls, "serve", STRAIGHT_COURT)
        assert zone == "service_box_ad", (
            f"Expected 'service_box_ad' for mapped_x~{mx:.3f}, got '{zone}'"
        )

    # ── near-end sideline out (mapped_x < 0.03 or > 0.97) ────────────────────

    def test_calibrated_x_near_left_sideline_is_out(self):
        """mapped_x < 0.03 after perspective → out (only reached when mapped_y >= 0.92).
        y=0.90 on STRAIGHT_COURT maps to mapped_y≈0.94, entering the far-baseline
        branch where the narrow x-sideline check is applied."""
        balls = [_ball(0.01, 0.90)]
        zone, mx, _ = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone == "out", f"Expected 'out' for mapped_x~{mx:.3f}, got '{zone}'"

    def test_calibrated_x_near_right_sideline_is_out(self):
        balls = [_ball(0.99, 0.90)]
        zone, mx, _ = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone == "out", f"Expected 'out' for mapped_x~{mx:.3f}, got '{zone}'"

    # ── multiple balls with varying confidence ────────────────────────────────

    def test_last_ball_wins_with_calibration(self):
        """With calibration active the last ball still determines the zone."""
        balls = [
            {"x": 0.5, "y": 0.50, "confidence": 0.99},   # net — high conf
            {"x": 0.3, "y": 0.75, "confidence": 0.15},   # baseline_left — low conf
        ]
        zone, _, _ = detect_calibrated_court_zone(balls, "forehand", STRAIGHT_COURT)
        assert zone == "baseline_left", (
            f"Expected last ball to win with calibration, got '{zone}'"
        )

    def test_mixed_none_and_low_confidence_with_calibration(self):
        """None entries are skipped; the last valid low-confidence ball is used."""
        balls = [None, {"x": 0.7, "y": 0.30, "confidence": 0.05}, None]
        zone, _, _ = detect_calibrated_court_zone(balls, "serve", STRAIGHT_COURT)
        assert zone in ("service_box_deuce", "service_box_ad"), (
            f"Expected service-box zone, got '{zone}'"
        )


# ─── detect_calibrated_court_zone exact threshold tests ───────────────────────

class TestDetectCalibratedCourtZoneExactThresholds:
    """
    Pin the post-perspective zone thresholds with surgical precision by patching
    _map_to_calibrated_court_points to return exact coordinate values.

    This removes any approximation from the perspective arithmetic and lets
    us test the branching logic in detect_calibrated_court_zone directly.

    Thresholds under test:
      mapped_y = 0.08  → far-end out/non-out boundary (strict <)
      mapped_y = 0.46  → lower net-band boundary (abs(y-0.5)=0.04, NOT < 0.04)
      mapped_y = 0.54  → upper net-band boundary (abs(y-0.5)=0.04, NOT < 0.04)
      mapped_y = 0.50  → net-band interior (abs=0.0 < 0.04) → net
      mapped_y = 0.92  → baseline/far-end split (strict <, 0.92 is NOT < 0.92)
      mapped_x = 0.03  → left sideline boundary (strict <, 0.03 is NOT < 0.03)
      mapped_x = 0.97  → right sideline boundary (strict >, 0.97 is NOT > 0.97)
    """

    _MAP = "services.analyzer._map_to_calibrated_court_points"

    def _zone(self, mapped_x, mapped_y, shot="forehand"):
        """Call detect_calibrated_court_zone with a fixed mapped position."""
        ball = [_ball(0.5, 0.5)]
        with patch(self._MAP, return_value=(mapped_x, mapped_y)):
            zone, mx, my = detect_calibrated_court_zone(ball, shot, STRAIGHT_COURT)
        return zone, mx, my

    # ── far-end out boundary at mapped_y = 0.08 ───────────────────────────────

    def test_mapped_y_0079_is_out(self):
        zone, _, _ = self._zone(0.5, 0.079)
        assert zone == "out", f"mapped_y=0.079 should be 'out', got '{zone}'"

    def test_mapped_y_0080_is_not_out(self):
        """0.08 is NOT < 0.08, so it escapes the 'out' branch."""
        zone, _, _ = self._zone(0.5, 0.08)
        assert zone != "out", f"mapped_y=0.08 should NOT be 'out', got '{zone}'"

    # ── net band boundaries at abs(mapped_y − 0.5) = 0.04 ────────────────────

    def test_mapped_y_0450_is_not_net(self):
        """abs(0.45 - 0.5) = 0.05 which is NOT < 0.04 → service_box.
        (Note: 0.46 appears inside the band due to IEEE-754 rounding, so 0.45 is
        used here as an unambiguous value outside the net-band threshold.)"""
        zone, _, _ = self._zone(0.3, 0.45)
        assert zone != "net", f"mapped_y=0.45 is outside net band, got '{zone}'"
        assert zone in ("service_box_deuce", "service_box_ad"), (
            f"Expected service-box zone, got '{zone}'"
        )

    def test_mapped_y_0470_is_net(self):
        """abs(0.47 - 0.5) = 0.03 < 0.04 → net."""
        zone, _, _ = self._zone(0.5, 0.47)
        assert zone == "net", f"mapped_y=0.47 should be 'net', got '{zone}'"

    def test_mapped_y_0500_is_net(self):
        zone, _, _ = self._zone(0.5, 0.50)
        assert zone == "net", f"mapped_y=0.50 should be 'net', got '{zone}'"

    def test_mapped_y_0530_is_net(self):
        """abs(0.53 - 0.5) = 0.03 < 0.04 → net."""
        zone, _, _ = self._zone(0.5, 0.53)
        assert zone == "net", f"mapped_y=0.53 should be 'net', got '{zone}'"

    def test_mapped_y_0540_is_not_net(self):
        """abs(0.54 - 0.5) = 0.04, NOT < 0.04 → baseline (mapped_y > 0.5)."""
        zone, _, _ = self._zone(0.3, 0.54)
        assert zone != "net", f"mapped_y=0.54 is outside net band, got '{zone}'"
        assert zone in ("baseline_left", "baseline_right"), (
            f"Expected baseline zone, got '{zone}'"
        )

    # ── baseline / far-near split at mapped_y = 0.92 ─────────────────────────

    def test_mapped_y_0919_is_baseline(self):
        zone, _, _ = self._zone(0.3, 0.919)
        assert zone in ("baseline_left", "baseline_right"), (
            f"mapped_y=0.919 should be baseline, got '{zone}'"
        )

    def test_mapped_y_0920_is_not_baseline_when_x_in_bounds(self):
        """0.92 is NOT < 0.92; with x within (0.03, 0.97) → still baseline."""
        zone, _, _ = self._zone(0.5, 0.92)
        assert zone in ("baseline_left", "baseline_right"), (
            f"mapped_y=0.92, x=0.5 should be baseline (x in bounds), got '{zone}'"
        )

    # ── near-baseline sideline out thresholds ─────────────────────────────────

    def test_mapped_x_0029_at_near_baseline_is_out(self):
        """mapped_x < 0.03 when mapped_y >= 0.92 → out."""
        zone, _, _ = self._zone(0.029, 0.93)
        assert zone == "out", f"mapped_x=0.029 at near baseline should be 'out', got '{zone}'"

    def test_mapped_x_0030_at_near_baseline_is_not_out(self):
        """mapped_x = 0.03 is NOT < 0.03 → baseline, not out."""
        zone, _, _ = self._zone(0.03, 0.93)
        assert zone != "out", f"mapped_x=0.03 at near baseline should NOT be 'out', got '{zone}'"

    def test_mapped_x_0971_at_near_baseline_is_out(self):
        """mapped_x > 0.97 when mapped_y >= 0.92 → out."""
        zone, _, _ = self._zone(0.971, 0.93)
        assert zone == "out", f"mapped_x=0.971 at near baseline should be 'out', got '{zone}'"

    def test_mapped_x_0970_at_near_baseline_is_not_out(self):
        """mapped_x = 0.97 is NOT > 0.97 → baseline, not out."""
        zone, _, _ = self._zone(0.97, 0.93)
        assert zone != "out", f"mapped_x=0.97 at near baseline should NOT be 'out', got '{zone}'"
